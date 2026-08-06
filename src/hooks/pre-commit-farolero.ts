#!/usr/bin/env bun
// PreToolUse hook on `git commit*`: if the target repo has farolero installed
// (https://github.com/darkroomengineering/farolero — Darkroom's house-standards
// ratchet, works without Claude Code or any agent harness), run
// `farolero ratchet --changed` and block the commit on a red gate.
//
// Why here, given farolero already ships its own commit-time git hook: this is
// the fallback for the common gap — a repo declares farolero as a devDependency
// (so `npx farolero …` resolves locally) but never ran `farolero install-hooks`, so
// nothing actually enforces it at commit time. If farolero's OWN git hooks are
// already active for this repo, we skip entirely (step 4 below) — git itself
// will run farolero for this commit, and double-running would double the latency
// for zero added enforcement. This hook never replaces farolero's own hooks or
// its CI check-baseline job; it only makes Claude Code a good citizen when
// the human/agent skipped the one-time `farolero install-hooks` step.
//
// It is ALSO the backstop when a commit carries `--no-verify`/`-n`: that flag
// makes git skip its OWN pre-commit hook entirely, so deferring to "farolero's
// native hook is active" in that case would leave nothing gating the commit —
// exactly the bypass farolero exists to close. See hasNoVerifyFlag below: when
// present, the defer-to-native-hook skip is disabled and the ratchet always
// runs (still subject to the same dependency/binary/fail-open checks).
//
// Fail-open on every operational failure: missing dependency, missing binary,
// spawn error, timeout, or a non-1 exit code. Only a genuine ratchet exit
// code of 1 (gate failure — see farolero's src/commands/ratchet.ts) blocks.

import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { blockDecision, runHook } from "../lib/hook-runtime.ts";

const RATCHET_TIMEOUT_MS = 30_000;
const REASON_TAIL_CHARS = 2000;
const SEPARATOR_RE = /&&|\|\||[;&|\n]/;

/** Strips single/double-quoted spans (so a flag-looking token embedded in a commit message,
 *  e.g. `-m "notes: --dry-run mode"`, isn't mistaken for the real --dry-run/--help flag) before
 *  tokenizing on whitespace. Not a full shell parser — just enough to keep quoted message text
 *  out of the exemption check. Exported for the exemption tests. */
export function stripQuotedSpans(cmd: string): string {
  return cmd.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, " ");
}

/** Strips quoted spans, splits on shell separators (`;`, `&&`, `||`, `|`, newline), and returns
 *  just the FIRST segment's tokens — the one the `^git\s+commit` anchor matched. A later
 *  segment's flags must never change how the anchor-matched commit is judged: in
 *  `git commit -m x && git commit --dry-run`, the exemption on the second commit must not leak
 *  onto the first, real one. Later segments are out of scope for this best-effort check —
 *  farolero's own hook is the real enforcement layer for anything past the first segment. */
function firstSegmentTokens(cmd: string): string[] {
  const stripped = stripQuotedSpans(cmd);
  const firstSegment = stripped.split(SEPARATOR_RE)[0] ?? "";
  return firstSegment.trim().split(/\s+/).filter(Boolean);
}

/** True if `cmd` is a `git commit` invocation this hook should gate: anchored to the start of
 *  the string (unlike pre-push-proof.ts's compound-command splitting — a plain anchor is
 *  sufficient here since the risk this hook closes is "the dependency exists but was never
 *  wired up," not "a disguised commit buried in a compound command"), and not `--dry-run` /
 *  `--help` on the anchor-matched segment (nothing is actually committed / informational only).
 *  Exported for tests. */
export function shouldGateCommit(cmd: string): boolean {
  if (!/^git\s+commit\b/.test(cmd)) return false;
  const tokens = firstSegmentTokens(cmd);
  return !tokens.some((t) => t === "--dry-run" || t === "--help");
}

/** True if the anchor-matched `git commit` segment carries `--no-verify`/`-n` — git's own flag
 *  to skip the pre-commit (and commit-msg) hook entirely for this commit. When true, the
 *  defer-to-native-hook skip in main() must be disabled: a native hook that git isn't even going
 *  to run can't be the thing enforcing farolero for this commit. Exported for tests. */
export function hasNoVerifyFlag(cmd: string): boolean {
  const tokens = firstSegmentTokens(cmd);
  return tokens.some((t) => t === "--no-verify" || t === "-n");
}

/** `"farolero" in dependencies/devDependencies` — same pattern as
 *  proof-of-work.ts's detectReactDoctor/detectDeslop. Exported for tests. */
export async function hasFaroleroDependency(cwd: string): Promise<boolean> {
  const pkg = (await Bun.file(join(cwd, "package.json"))
    .json()
    .catch(() => ({}))) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return "farolero" in deps;
}

async function gitConfigGet(cwd: string, key: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "config", "--get", key], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return null;
    const value = out.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** True only if `filePath` both carries the `farolero-managed` marker AND is executable — git
 *  silently ignores a non-executable hook file, so a marker on one is not "active" by git's own
 *  rules and must not be treated as such here.
 *
 *  Windows is the exception: NTFS has no POSIX execute bit, `statSync().mode` never reports one,
 *  and Git for Windows runs a hook that merely exists (core.filemode is false there). Applying the
 *  bit test on Windows would make this always false, so farolero's own hooks would never be
 *  detected and the ratchet would run twice on every commit. On Windows the marker alone decides. */
async function hookHasFaroleroMarker(filePath: string): Promise<boolean> {
  try {
    const content = await Bun.file(filePath).text();
    if (!content.includes("farolero-managed")) return false;
    if (process.platform === "win32") return true;
    return (statSync(filePath).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** True if farolero's own git hooks are already wired up for this repo. When `core.hooksPath` is
 *  configured, git uses ONLY that directory — `.git/hooks` is ignored entirely — so this checks
 *  ONLY the configured directory in that case and never falls back to `.git/hooks` (a stale
 *  marker left over there from before hooksPath was set must not count). `core.hooksPath` unset
 *  is the only case that checks the default `.git/hooks/pre-commit`. The plain `.git/hooks` path
 *  (rather than resolving via `git rev-parse --git-path hooks`) is acceptable here: this is
 *  best-effort skip logic, not a correctness-critical resolution — worst case on a linked
 *  worktree is one redundant farolero run, not a missed gate (farolero's own hook, wherever it
 *  actually lives, still runs and still gates). Exported for tests. */
export async function faroleroHooksAlreadyActive(cwd: string): Promise<boolean> {
  const hooksPath = await gitConfigGet(cwd, "core.hooksPath");
  if (hooksPath) {
    const dir = isAbsolute(hooksPath) ? hooksPath : join(cwd, hooksPath);
    return hookHasFaroleroMarker(join(dir, "pre-commit"));
  }
  return hookHasFaroleroMarker(join(cwd, ".git", "hooks", "pre-commit"));
}

async function runFaroleroRatchetChanged(
  binPath: string,
  cwd: string,
): Promise<{ code: number | null; combined: string }> {
  const proc = Bun.spawn([binPath, "ratchet", "--changed"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), RATCHET_TIMEOUT_MS);
  try {
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, combined: `${out}${err}` };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  // Self-gate: the group-level `if:` filter isn't reliably applied by every Claude Code build
  // (see pre-commit-tsc.ts's comment) — re-check the command here.
  const cmd = process.env.TOOL_INPUT_command ?? "";
  if (!shouldGateCommit(cmd)) return; // allow

  const cwd = process.cwd();
  if (!(await hasFaroleroDependency(cwd))) return; // farolero not a dependency here — allow

  const faroleroBin = join(cwd, "node_modules", ".bin", "farolero");
  if (!existsSync(faroleroBin)) return; // declared but not installed — allow, silently

  // --no-verify/-n makes git skip ITS OWN pre-commit hook for this commit — so if farolero's hook
  // is what would normally enforce this repo, it will NOT run for this specific commit. Never
  // defer to it in that case, regardless of whether it's otherwise "active."
  if (!hasNoVerifyFlag(cmd) && (await faroleroHooksAlreadyActive(cwd))) return;

  let result: { code: number | null; combined: string };
  try {
    result = await runFaroleroRatchetChanged(faroleroBin, cwd);
  } catch (error) {
    // Spawn failure — an infrastructure problem, never block a commit on it.
    console.error(
      `[pre-commit-farolero] failed to run farolero: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  // Only a genuine gate failure (exit 1) blocks. Exit 0 is a pass; exit 2 is farolero's own
  // operational-error code; null/other means the process was killed (timeout) or exited via
  // signal — all of those are infrastructure states, not "the ratchet caught something."
  if (result.code !== 1) return;

  const tail = result.combined.trimEnd().slice(-REASON_TAIL_CHARS);
  blockDecision(
    `${tail}\n\nfarolero ratchet failed — fix the violations or lower/raise the baseline deliberately ` +
      "(farolero baseline write); never bypass with --no-verify.",
  );
}

if (import.meta.main) {
  // Fail-open wrapper: any uncaught error here allows the commit. A genuine gate failure calls
  // blockDecision() (exit 2) inside main() before this ever gets a chance to matter.
  await runHook(main);
  process.exit(0);
}
