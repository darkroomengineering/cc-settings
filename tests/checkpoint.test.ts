// checkpoint.ts CLI regressions:
//   - M18: an unrecognized subcommand must exit 1 (matching handoff.ts's
//     contract), not fall through to exit 0 like a genuine success.
//   - L11 (smoke coverage): `clean`/`list` behave normally against a
//     project-scoped checkpoint dir with several valid entries — the per-entry
//     try/catch refactor must not regress the happy path. The exact TOCTOU
//     race (a file vanishing between listArtifacts' readdir and the
//     per-entry lstatSync) is not practically reproducible from outside the
//     process; verified by code review instead (see notes).
//
// HOME is sandboxed to a tmp dir, and each test runs inside its own tmp git
// repo (checkpoint.ts derives the project name from `git rev-parse
// --show-toplevel`) — same pattern as tests/freeze.test.ts.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "..", "src", "scripts", "checkpoint.ts");

async function run(
  args: string[],
  cwd: string,
  home: string,
): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", SCRIPT, ...args], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

async function makeRepo(): Promise<{ repo: string; home: string }> {
  const repo = await mkdtemp(join(tmpdir(), "cc-checkpoint-repo-"));
  const home = await mkdtemp(join(tmpdir(), "cc-checkpoint-home-"));
  await Bun.spawn(["git", "init", "-q"], { cwd: repo }).exited;
  await Bun.spawn(["git", "-C", repo, "config", "user.email", "t@example.com"]).exited;
  await Bun.spawn(["git", "-C", repo, "config", "user.name", "Test"]).exited;
  await writeFile(join(repo, "README.md"), "hello\n");
  await Bun.spawn(["git", "-C", repo, "add", "-A"]).exited;
  await Bun.spawn(["git", "-C", repo, "commit", "-q", "-m", "init"]).exited;
  return { repo, home };
}

async function cleanup(repo: string, home: string): Promise<void> {
  await rm(repo, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
}

describe("checkpoint.ts subcommand dispatch", () => {
  test("unknown subcommand exits 1 and prints usage (M18)", async () => {
    const { repo, home } = await makeRepo();
    try {
      const { stdout, exit } = await run(["restroe", "latest"], repo, home);
      expect(exit).toBe(1);
      expect(stdout).toContain("Usage: checkpoint.ts");
    } finally {
      await cleanup(repo, home);
    }
  });

  test("no subcommand (help/default) also exits 1 and prints usage", async () => {
    const { repo, home } = await makeRepo();
    try {
      const { stdout, exit } = await run([], repo, home);
      expect(exit).toBe(1);
      expect(stdout).toContain("Usage: checkpoint.ts");
    } finally {
      await cleanup(repo, home);
    }
  });

  test("a recognized subcommand (list) still exits 0", async () => {
    const { repo, home } = await makeRepo();
    try {
      const { exit } = await run(["list"], repo, home);
      expect(exit).toBe(0);
    } finally {
      await cleanup(repo, home);
    }
  });
});

describe("checkpoint.ts save/list/clean happy path (L11 regression guard)", () => {
  test("save then list shows the checkpoint; clean keeps only the requested count", async () => {
    const { repo, home } = await makeRepo();
    try {
      for (const label of ["one", "two", "three"]) {
        const { exit } = await run(["save", label], repo, home);
        expect(exit).toBe(0);
      }
      const list = await run(["list"], repo, home);
      expect(list.stdout).toContain("three");
      expect(list.stdout).toContain(basename(repo));

      const clean = await run(["clean", "1"], repo, home);
      expect(clean.exit).toBe(0);
      expect(clean.stdout).toContain("Removing 2 old checkpoints");

      const listAfter = await run(["list"], repo, home);
      // Only the most recent ("three") should remain.
      expect(listAfter.stdout).toContain("three");
      expect(listAfter.stdout).not.toContain("one");
    } finally {
      await cleanup(repo, home);
    }
  });

  test("clean on an empty checkpoint dir reports nothing to clean, not an error", async () => {
    const { repo, home } = await makeRepo();
    try {
      // Force the per-project dir to exist but be empty (no saves yet).
      await mkdir(join(home, ".claude", "checkpoints", basename(repo)), { recursive: true });
      const { stdout, exit } = await run(["clean"], repo, home);
      expect(exit).toBe(0);
      expect(stdout).toContain("Nothing to clean");
    } finally {
      await cleanup(repo, home);
    }
  });
});
