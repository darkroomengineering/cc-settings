#!/usr/bin/env bun
import { appendFile, mkdir, readFile, realpath, stat, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { type HookIO, isPlainObject, processIO, runHook } from "../lib/hook-runtime.ts";
import { claudePath, sha256, whichCommand } from "../lib/platform.ts";

const TOGGLE = "CC_SESSION_WORKTREE_CLEANUP_ENABLED";

function stateFile(sessionId: string): string {
  return join(claudePath("tmp"), `session-worktrees-${sha256(sessionId)}.jsonl`);
}

function log(error: unknown): void {
  console.error(`[session-worktrees] ${error instanceof Error ? error.message : String(error)}`);
}

export function cleanArgs(paths: string[]): string[] {
  return [
    "storage",
    "clean",
    ...paths.flatMap((path) => ["--path", path]),
    "--now",
    "--include-external",
    "--json",
  ];
}

export function findPrograma(): string | null {
  return (
    whichCommand("programa") ??
    Bun.which(join(process.env.HOME ?? homedir(), ".local", "bin", "programa")) ??
    Bun.which("/Applications/Programa.app/Contents/Resources/bin/programa")
  );
}

export async function linkedWorktree(path: string): Promise<string | null> {
  if (!isAbsolute(path)) return null;
  const proc = Bun.spawn(
    [
      "git",
      "-C",
      path,
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
      "--git-common-dir",
      "--show-toplevel",
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 2_000, killSignal: "SIGKILL" },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exit !== 0) {
    if (stderr.trim()) log(stderr.trim());
    return null;
  }
  const [gitDir, commonDir, root] = stdout.trim().split("\n");
  if (!gitDir || !commonDir || !root || !isAbsolute(root)) return null;
  const [git, common, canonicalRoot] = await Promise.all([
    realpath(gitDir),
    realpath(commonDir),
    realpath(root),
  ]);
  return git !== common ? canonicalRoot : null;
}

async function record(file: string, path: unknown): Promise<void> {
  if (typeof path !== "string") return;
  const root = await linkedWorktree(path);
  if (!root) return;
  await mkdir(claudePath("tmp"), { recursive: true });
  // One append per root preserves records from simultaneous Agent completions.
  await appendFile(file, `${JSON.stringify(root)}\n`);
}

async function recordedPaths(file: string): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) log(error);
    return [];
  }
  await unlink(file);
  const paths = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const path: unknown = JSON.parse(line);
      if (typeof path === "string" && isAbsolute(path)) paths.add(path);
    } catch (error) {
      log(error);
    }
  }
  const roots = await Promise.all(
    [...paths].map(async (path) => {
      try {
        const root = await linkedWorktree(path);
        // Revalidate roots so a main checkout never becomes a cleanup scope.
        return root === path ? root : null;
      } catch (error) {
        log(error);
        return null;
      }
    }),
  );
  return roots.filter((root) => root !== null);
}

async function cleanupCwd(paths: string[]): Promise<string> {
  for (const candidate of [claudePath("tmp"), tmpdir(), homedir()]) {
    const dir = await realpath(candidate).catch(() => null);
    if (!dir) continue;
    const insideTarget = paths.some((path) => {
      const fromRoot = relative(path, dir);
      return (
        fromRoot === "" ||
        (!isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`))
      );
    });
    if (!insideTarget) return dir;
  }
  throw new Error("No working directory outside the cleanup paths");
}

async function clean(file: string): Promise<void> {
  const paths = await recordedPaths(file);
  if (paths.length === 0) return;
  const programa = findPrograma();
  if (!programa) return;
  const cwd = await cleanupCwd(paths);
  // Programa checks every process, including this hook, for a cwd inside a target.
  process.chdir(cwd);
  const proc = Bun.spawn([programa, ...cleanArgs(paths)], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exit !== 0) {
    log(`Programa cleanup skipped (exit ${exit}): ${stderr.trim()}`);
    return;
  }
  // The scoped-clean contract does not specify JSON fields; verify removal on disk.
  JSON.parse(stdout);
  let removed = 0;
  for (const path of paths) {
    try {
      await stat(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") removed++;
      else log(error);
    }
  }
  if (removed > 0) {
    console.log(`Removed ${removed} merged worktree${removed === 1 ? "" : "s"}`);
  }
}

export async function main(io: HookIO = processIO): Promise<void> {
  const input = await io.hookInput<{
    session_id: unknown;
    hook_event_name: unknown;
    tool_name: unknown;
    tool_response: unknown;
  }>();
  if (typeof input.session_id !== "string" || !input.session_id) return;
  const file = stateFile(input.session_id);
  const ending = input.hook_event_name === "SessionEnd";
  try {
    const enabled = process.env[TOGGLE];
    if (enabled !== undefined && enabled !== "true" && enabled !== "1") return;
    if (
      input.hook_event_name === "PostToolUse" &&
      typeof input.tool_name === "string" &&
      ["Agent", "Task", "EnterWorktree"].includes(input.tool_name) &&
      isPlainObject(input.tool_response)
    ) {
      await record(file, input.tool_response.worktreePath);
    }
    if (ending) await clean(file);
  } catch (error) {
    log(error);
  } finally {
    if (ending) {
      await unlink(file).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) log(error);
      });
    }
  }
}

if (import.meta.main) await runHook(main);
