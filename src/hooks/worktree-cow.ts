#!/usr/bin/env bun
// WorktreeCreate / WorktreeRemove: Claude Code worktrees made with `git cow add`,
// a copy-on-write clone of a spare checkout, so gitignored dependencies and build
// output are already in place. Without git-cow it falls back to `git worktree add`.
//
// A WorktreeCreate command hook replaces native creation: the last stdout line is
// the worktree path, everything else goes to stderr, and a non-zero exit fails
// creation. The hook also owns what native creation would do: the
// `worktree-<name>` branch, `worktree.baseRef`, reuse of an existing worktree,
// and `.worktreeinclude`. Contract: https://code.claude.com/docs/en/hooks#worktreecreate

import { constants, existsSync, writeSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { findGitCow } from "../lib/git-cow.ts";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WORKTREES_DIR = join(".claude", "worktrees");

interface Run {
  exit: number;
  stdout: string;
}

function log(message: string): void {
  process.stderr.write(`[worktree-cow] ${message}\n`);
}

/** Runs argv (never a shell string). Child stderr goes to ours; stdout is
 *  returned, and forwarded to stderr when `echo` is set, so it never reaches
 *  the stdout line Claude Code reads as the worktree path. */
async function run(
  argv: string[],
  opts: { cwd: string; env?: Record<string, string>; echo?: boolean; stdin?: string },
): Promise<Run> {
  const proc = Bun.spawn(argv, {
    cwd: opts.cwd,
    env: opts.env ?? (process.env as Record<string, string>),
    stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exit] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (opts.echo && stdout) process.stderr.write(stdout);
  return { exit, stdout };
}

const git = (cwd: string, args: string[], echo = false): Promise<Run> =>
  run(["git", "-C", cwd, ...args], { cwd, echo });

function home(): string {
  return process.env.HOME || homedir();
}

/** git with git-cow's directory on PATH, so `git cow` resolves from ~/.cargo/bin. */
function cowEnv(bin: string): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  env.PATH = [dirname(bin), env.PATH].filter(Boolean).join(delimiter);
  return env;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  locked: boolean;
}

/** `git worktree list --porcelain`, main checkout first, paths realpath'd. */
async function listWorktrees(cwd: string): Promise<WorktreeEntry[] | null> {
  const out = await git(cwd, ["worktree", "list", "--porcelain"]);
  if (out.exit !== 0) return null;
  const entries: WorktreeEntry[] = [];
  for (const block of out.stdout.split("\n\n")) {
    let path: string | null = null;
    let branch: string | null = null;
    let locked = false;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("branch refs/heads/"))
        branch = line.slice("branch refs/heads/".length);
      else if (line === "locked" || line.startsWith("locked ")) locked = true;
    }
    if (path) entries.push({ path: await realpath(path).catch(() => path), branch, locked });
  }
  return entries;
}

async function isWorktree(root: string, path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  const real = await realpath(path);
  return (await listWorktrees(root))?.some((e) => e.path === real) ?? false;
}

const BaseRefSettings = z.object({
  worktree: z.object({ baseRef: z.enum(["fresh", "head"]).optional() }).optional(),
});

async function baseRefSetting(root: string): Promise<"fresh" | "head"> {
  const files = [
    join(root, ".claude", "settings.local.json"),
    join(root, ".claude", "settings.json"),
    join(home(), ".claude", "settings.json"),
  ];
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, "utf8"));
    } catch {
      continue;
    }
    const parsed = BaseRefSettings.safeParse(raw);
    const value = parsed.success ? parsed.data.worktree?.baseRef : undefined;
    if (value) return value;
  }
  return "fresh";
}

/** "fresh": the remote default branch (origin/HEAD, then origin/main); "head": local HEAD. */
async function resolveBase(root: string): Promise<string> {
  if ((await baseRefSetting(root)) === "head") return "HEAD";
  const symbolic = await git(root, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
  const remoteHead = symbolic.stdout.trim();
  if (symbolic.exit === 0 && remoteHead) return remoteHead;
  if ((await git(root, ["rev-parse", "--verify", "-q", "refs/remotes/origin/main"])).exit === 0) {
    return "origin/main";
  }
  log("no origin/HEAD or origin/main; starting from HEAD");
  return "HEAD";
}

async function ensureIgnored(root: string): Promise<void> {
  if ((await git(root, ["check-ignore", "-q", `${WORKTREES_DIR}/`])).exit === 0) return;
  const common = await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const dir = common.stdout.trim();
  if (common.exit !== 0 || !isAbsolute(dir)) return;
  await mkdir(join(dir, "info"), { recursive: true });
  const exclude = join(dir, "info", "exclude");
  const current = await readFile(exclude, "utf8").catch(() => "");
  const lead = current && !current.endsWith("\n") ? "\n" : "";
  await appendFile(exclude, `${lead}/${WORKTREES_DIR}/\n`);
}

/** Copy files that match `.worktreeinclude` and are gitignored, skipping files
 *  the clone already brought and anything under .claude/worktrees/. */
async function copyIncluded(root: string, target: string): Promise<void> {
  if (!existsSync(join(root, ".worktreeinclude"))) return;
  const matched = await git(root, [
    "ls-files",
    "-z",
    "--others",
    "--ignored",
    "--exclude-from=.worktreeinclude",
  ]);
  if (matched.exit !== 0) return;
  const candidates = matched.stdout
    .split("\0")
    .filter((p) => p && !p.startsWith(`${WORKTREES_DIR}/`));
  if (candidates.length === 0) return;
  const ignored = await run(["git", "-C", root, "check-ignore", "-z", "--stdin"], {
    cwd: root,
    stdin: `${candidates.join("\0")}\0`,
  });
  for (const rel of ignored.stdout.split("\0").filter(Boolean)) {
    const to = join(target, rel);
    if (existsSync(to)) continue;
    try {
      await mkdir(dirname(to), { recursive: true });
      await copyFile(join(root, rel), to, constants.COPYFILE_FICLONE);
    } catch (error) {
      log(`could not copy ${rel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const CreateInput = z.object({ name: z.string(), cwd: z.string().optional() });

export async function create(raw: string): Promise<number> {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  const input = CreateInput.safeParse(payload);
  // No usable payload: print nothing, so Claude Code reports the missing path.
  if (!input.success) return 0;
  const { name } = input.data;
  if (!NAME.test(name) || name.includes("..")) {
    log(`refusing worktree name ${JSON.stringify(name)}`);
    return 1;
  }
  const cwd = input.data.cwd && isAbsolute(input.data.cwd) ? input.data.cwd : process.cwd();
  const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (top.exit !== 0 || !top.stdout.trim()) {
    log(`${cwd} is not inside a git repository`);
    return 1;
  }
  const root = await realpath(top.stdout.trim());
  const path = join(root, WORKTREES_DIR, name);
  const branch = `worktree-${name}`;

  if (await isWorktree(root, path)) {
    log(`reusing existing worktree ${path}`);
  } else {
    await ensureIgnored(root);
    const branchExists =
      (await git(root, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`])).exit === 0;
    const target = branchExists ? [path, branch] : ["-b", branch, path, await resolveBase(root)];
    const cow = findGitCow(process.env.PATH ?? "", home());
    if (cow) {
      // git-cow reads the repository from its working directory.
      const result = await run(["git", "cow", "add", ...target], {
        cwd: root,
        env: cowEnv(cow),
        echo: true,
      });
      if (result.exit !== 0) log(`git cow add exited ${result.exit}`);
    }
    if (!existsSync(path)) {
      await run(["git", "-C", root, "worktree", "add", ...target], { cwd: root, echo: true });
    }
    if (!(await isWorktree(root, path))) {
      log(`no worktree at ${path}`);
      return 1;
    }
    await copyIncluded(root, path);
  }
  // Synchronous: process.exit follows, and Claude Code reads this line as the path.
  writeSync(1, `${await realpath(path)}\n`);
  return 0;
}

const RemoveInput = z.object({ worktree_path: z.string() });

export async function remove(raw: string): Promise<number> {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  const input = RemoveInput.safeParse(payload);
  if (!input.success || !isAbsolute(input.data.worktree_path)) return 0;
  if (!existsSync(input.data.worktree_path)) return 0;
  const path = await realpath(input.data.worktree_path);
  if (path.includes("/.git-cow/")) {
    log(`${path} is the git-cow spare checkout, not removed`);
    return 1;
  }
  const entries = await listWorktrees(path);
  const index = entries?.findIndex((e) => e.path === path) ?? -1;
  const entry = entries?.[index];
  const main = entries?.[0];
  if (!entry || !main || index <= 0) {
    log(`${path} is not a linked worktree, not removed`);
    return 1;
  }
  if (entry.locked) {
    log(`${path} is locked, not removed`);
    return 1;
  }
  const root = main.path;
  const cow = findGitCow(process.env.PATH ?? "", home());
  if (cow) {
    // Claude Code asked the user before removing, so uncommitted changes go too.
    await run(["git", "cow", "remove", "--warm", "--force", path], {
      cwd: root,
      env: cowEnv(cow),
      echo: true,
    });
  }
  if (existsSync(path)) {
    const removed = await git(root, ["worktree", "remove", "--force", path], true);
    const ours = `worktree-${basename(path)}`;
    if (removed.exit === 0 && entry.branch === ours) {
      // -d deletes only a merged branch; an unmerged one stays.
      await git(root, ["branch", "-d", ours], true);
    }
  }
  if (existsSync(path)) {
    log(`${path} still exists`);
    return 1;
  }
  return 0;
}

async function main(): Promise<number> {
  const mode = process.argv[2];
  const raw = await Bun.stdin.text();
  try {
    if (mode === "create") return await create(raw);
    if (mode === "remove") return await remove(raw);
    log(`unknown mode ${JSON.stringify(mode)}`);
    return 0;
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) process.exit(await main());
