import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sandbox } from "./tmp.ts";

// Fixture repos must never inherit the developer/CI machine's ambient git
// config (commit.gpgsign + a signing program, core.hooksPath, aliases, ...).
// Nulling both config files is what actually isolates everything in one
// place; per-repo user.email/user.name (set below) remain the only identity
// available once the global/system files are gone.
export const GIT_ISOLATION_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

export async function git(repo: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", "-C", repo, ...args], {
    env: { ...process.env, ...GIT_ISOLATION_ENV },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  if (exit !== 0) throw new Error(`git ${args.join(" ")} failed in ${repo}: ${stderr}`);
}

/** Repo with one committed baseline file, so `git log` / `git status` both
 *  work. `uncommittedChange`, if given, rewrites README.md after the commit
 *  so `git status --porcelain` / modifiedFiles is non-empty. */
export async function makeRepo(
  prefix: string,
  opts: { uncommittedChange?: string } = {},
): Promise<string> {
  const repo = await sandbox(prefix);
  await git(repo, ["init", "-q"]);
  await git(repo, ["config", "user.email", "t@example.com"]);
  await git(repo, ["config", "user.name", "Test"]);
  await writeFile(join(repo, "README.md"), "hello\n");
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-q", "-m", "initial commit"]);
  if (opts.uncommittedChange !== undefined) {
    await writeFile(join(repo, "README.md"), opts.uncommittedChange);
  }
  return repo;
}
