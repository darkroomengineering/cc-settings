import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sandbox } from "./tmp.ts";

const GITCONFIG_DIR = mkdtempSync(join(tmpdir(), "cc-fixture-gitconfig-"));
const EMPTY_GITCONFIG = join(GITCONFIG_DIR, "gitconfig");
writeFileSync(EMPTY_GITCONFIG, "");
// Other test files reuse this module after the importing file's afterAll hooks.
process.once("exit", () => rmSync(GITCONFIG_DIR, { recursive: true, force: true }));

// Environment config overrides file config, so isolate both sources.
export const GIT_ISOLATION_ENV = {
  GIT_CONFIG_GLOBAL: EMPTY_GITCONFIG,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_COUNT: "0",
  GIT_CONFIG_PARAMETERS: "",
};

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
