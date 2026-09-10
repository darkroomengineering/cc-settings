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
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { GIT_ISOLATION_ENV, git, makeRepo as makeGitRepo } from "./support/git.ts";
import { spawnCapture } from "./support/proc.ts";
import { cleanup as cleanupDirs, sandbox } from "./support/tmp.ts";

const SCRIPT = resolve(import.meta.dir, "..", "src", "scripts", "checkpoint.ts");

async function run(
  args: string[],
  cwd: string,
  home: string,
): Promise<{ stdout: string; exit: number }> {
  return spawnCapture(["bun", SCRIPT, ...args], {
    cwd,
    env: { ...GIT_ISOLATION_ENV, HOME: home, USERPROFILE: home },
  });
}

async function makeRepo(): Promise<{ repo: string; home: string }> {
  const repo = await makeGitRepo("cc-checkpoint-repo");
  const home = await sandbox("cc-checkpoint-home");
  return { repo, home };
}

async function cleanup(repo: string, home: string): Promise<void> {
  await cleanupDirs(repo, home);
}

describe("checkpoint.ts subcommand dispatch", () => {
  test("binary work survives checkpoint restore and the safety checkpoint restores later work", async () => {
    const { repo, home } = await makeRepo();
    try {
      const file = join(repo, "asset.bin");
      await writeFile(file, new Uint8Array([0, 1, 2]));
      await git(repo, ["add", "asset.bin"]);
      await git(repo, ["commit", "-qm", "binary baseline"]);
      const saved = new Uint8Array([0, 9, 9]);
      const later = new Uint8Array([0, 8, 8]);
      await writeFile(file, saved);
      expect((await run(["save", "binary"], repo, home)).exit).toBe(0);
      await writeFile(file, later);
      expect((await run(["restore"], repo, home)).exit).toBe(0);
      expect(new Uint8Array(await readFile(file))).toEqual(saved);
      expect((await run(["restore"], repo, home)).exit).toBe(0);
      expect(new Uint8Array(await readFile(file))).toEqual(later);
    } finally {
      await cleanup(repo, home);
    }
  });

  for (const damage of ["missing", "corrupt", "legacy binary"] as const) {
    test(`a ${damage} patch must be rejected before changing the worktree or index`, async () => {
      const { repo, home } = await makeRepo();
      try {
        const file = join(repo, "README.md");
        await writeFile(file, "checkpoint content\n");
        expect((await run(["save", "damaged"], repo, home)).exit).toBe(0);
        const checkpointDir = join(home, ".claude", "checkpoints", basename(repo));
        const patch = (await readdir(checkpointDir)).find((name) => name.endsWith(".patch"));
        if (!patch) throw new Error("save did not capture the dirty file");
        const path = join(checkpointDir, patch);
        if (damage === "missing") await rm(path);
        else
          await writeFile(
            path,
            damage === "corrupt"
              ? "invalid patch\n"
              : "diff --git a/README.md b/README.md\nBinary files a/README.md and b/README.md differ\n",
          );
        await writeFile(file, "staged later content\n");
        await git(repo, ["add", "README.md"]);
        await writeFile(file, "unstaged later content\n");
        const indexBefore = await spawnCapture(["git", "show", ":README.md"], {
          cwd: repo,
          env: GIT_ISOLATION_ENV,
        });
        expect((await run(["restore"], repo, home)).exit).toBe(1);
        expect(await readFile(file, "utf8")).toBe("unstaged later content\n");
        const indexAfter = await spawnCapture(["git", "show", ":README.md"], {
          cwd: repo,
          env: GIT_ISOLATION_ENV,
        });
        expect(indexAfter.stdout).toBe(indexBefore.stdout);
      } finally {
        await cleanup(repo, home);
      }
    });
  }
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
