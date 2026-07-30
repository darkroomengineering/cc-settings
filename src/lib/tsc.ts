// Shared `bunx tsc --noEmit` runner for the TypeScript hooks.
// post-edit-tsc.ts (filter output to the edited file) and pre-commit-tsc.ts
// (block the commit on errors) both spawn the same process and combine
// stdout+stderr; only the downstream policy differs, and that stays in each
// script.

import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TscResult {
  /** stdout followed by stderr, untrimmed — callers filter or tail as needed. */
  combined: string;
  exitCode: number;
}

export interface TscOptions {
  /** Working directory for the spawn; defaults to the current process cwd. */
  cwd?: string;
  /** Pass `--pretty` (the pre-commit hook tails human-readable output). */
  pretty?: boolean;
  /**
   * Reuse a cached `.tsbuildinfo` across runs (default true). The post-edit
   * hook fires once per edit, so a cold full-project check every time is the
   * dominant cost; incremental turns the repeat runs into a fraction of that.
   * Set false to force a cold check.
   */
  incremental?: boolean;
}

// A cold `bunx` fetch (offline registry) or a pathological tsconfig (huge
// project, circular references) can hang indefinitely. Both callers
// (pre-commit gate + post-edit diagnostic) await this synchronously, so an
// unbounded spawn freezes every commit / edit. Generous because a large
// monorepo's tsc run can legitimately take a while.
const TSC_TIMEOUT_MS = 120_000;

/**
 * TypeScript before 5.6 rejects `--incremental` alongside `--noEmit`, and a
 * `.tsbuildinfo` torn by two concurrent hook runs makes tsc complain about the
 * cache rather than the code. Both surface as an option/cache diagnostic
 * rather than a `TS2xxx` type error, so they're safe to distinguish and
 * retry cold. Deliberately narrow: it must be a tsc error line that names the
 * cache machinery, never a user type error that happens to mention it.
 */
const CACHE_UNUSABLE = /error TS\d+:[^\n]*(incremental|tsBuildInfoFile|buildinfo)/i;

/**
 * `--pretty` colourises even when piped, and it splits the diagnostic header
 * as `error<ESC>[0m<ESC>[90m TS2322` — so a pattern expecting `error TS####`
 * never matches the pre-commit hook's output. Strip escapes before matching.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the character being matched
const ANSI = /\u001b\[[0-9;]*m/g;

/** Remove ANSI colour escapes so text matching works on `--pretty` output. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/**
 * Per-project incremental cache path, under ~/.claude/tmp so a client repo
 * never gets a stray `.tsbuildinfo` showing up in `git status`. Keyed by cwd
 * so two projects can't invalidate each other's cache.
 */
function buildInfoPath(cwd: string): string {
  const dir = join(homedir(), ".claude", "tmp", "tsc-cache");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${createHash("sha256").update(cwd).digest("hex").slice(0, 16)}.tsbuildinfo`);
}

async function spawnTsc(options: TscOptions, cachePath: string | null): Promise<TscResult> {
  const argv = ["bunx", "tsc", "--noEmit"];
  if (options.pretty) argv.push("--pretty");
  if (cachePath) argv.push("--incremental", "--tsBuildInfoFile", cachePath);
  const proc = Bun.spawn(argv, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout: TSC_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { combined: stdout + stderr, exitCode };
}

/**
 * Run `bunx tsc --noEmit` (optionally `--pretty`) and return the combined
 * output plus exit code. Throws on spawn failure — callers keep their own
 * fail-open policy. Bounded by TSC_TIMEOUT_MS: on timeout Bun hard-kills the
 * process (SIGKILL, so a child that ignores SIGTERM can't outrun the cap)
 * and this resolves with whatever partial output was captured plus a
 * non-zero exit — callers already treat that as "fail open, don't block".
 *
 * Incremental by default, with a cold retry whenever the cache turns out to
 * be unusable — an unwritable HOME, a TypeScript too old for the flag combo,
 * or a corrupt buildinfo must never turn into a phantom type error.
 */
export async function runTsc(options: TscOptions = {}): Promise<TscResult> {
  if (options.incremental === false) return spawnTsc(options, null);

  let cachePath: string | null = null;
  try {
    cachePath = buildInfoPath(options.cwd ?? process.cwd());
  } catch {
    return spawnTsc(options, null); // unwritable HOME — run cold
  }

  const result = await spawnTsc(options, cachePath);
  if (result.exitCode !== 0 && CACHE_UNUSABLE.test(stripAnsi(result.combined))) {
    try {
      rmSync(cachePath, { force: true });
    } catch {
      // best effort — the cold retry below is what actually matters
    }
    return spawnTsc(options, null);
  }
  return result;
}
