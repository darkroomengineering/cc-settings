// handoff.ts CLI regressions:
//   - H11: the handoff store is scoped per project (like checkpoint.ts), not
//     one global directory — a handoff saved in project A must never surface
//     as "latest" when resuming in project B. A pre-existing legacy global
//     store is still resumable (one-time read fallback) until a project-scoped
//     store exists.
//   - H10: an automatic (no --summary) create populates real best-effort
//     content — branch, modified files, recent commits, project root — and
//     marks `source: "auto"`; a manual create with --summary marks
//     `source: "manual"`.
//
// HOME is sandboxed to a tmp dir, and each test runs inside its own tmp git
// repo — same pattern as tests/checkpoint.test.ts / tests/freeze.test.ts.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pointLatest } from "../src/lib/artifact-store.ts";

const SCRIPT = resolve(import.meta.dir, "..", "src", "scripts", "handoff.ts");

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

async function makeRepo(name: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `cc-handoff-${name}-`));
  await Bun.spawn(["git", "init", "-q"], { cwd: repo }).exited;
  await Bun.spawn(["git", "-C", repo, "config", "user.email", "t@example.com"]).exited;
  await Bun.spawn(["git", "-C", repo, "config", "user.name", "Test"]).exited;
  await writeFile(join(repo, "README.md"), "hello\n");
  await Bun.spawn(["git", "-C", repo, "add", "-A"]).exited;
  await Bun.spawn(["git", "-C", repo, "commit", "-q", "-m", "initial commit"]).exited;
  // One uncommitted change so git status --porcelain / modifiedFiles is non-empty.
  await writeFile(join(repo, "README.md"), "hello again\n");
  return repo;
}

describe("handoff.ts per-project scoping (H11)", () => {
  test("create writes under handoffs/<project>, not the flat global dir", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-handoff-home-"));
    const repo = await makeRepo("proj-a");
    try {
      const { exit } = await run(["create", "--summary", "did stuff"], repo, home);
      expect(exit).toBe(0);

      const projectDir = join(home, ".claude", "handoffs", basename(repo));
      const entries = await Bun.file(join(projectDir, "latest.json")).exists();
      expect(entries).toBe(true);

      // Nothing should have landed directly in the flat global handoffs dir.
      const globalDirEntries = await import("node:fs/promises").then((fs) =>
        fs.readdir(join(home, ".claude", "handoffs")).catch(() => []),
      );
      // Only the <project> subdirectory should exist at the top level.
      expect(globalDirEntries).toEqual([basename(repo)]);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("a handoff saved in project A never resumes as latest in project B", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-handoff-home-"));
    const repoA = await makeRepo("cross-a");
    const repoB = await makeRepo("cross-b");
    try {
      await run(["create", "--summary", "project A work"], repoA, home);

      // No handoff of its own yet, and no legacy global store either — must
      // report "no handoff found", never fall through to project A's data.
      const resumeB = await run(["resume"], repoB, home);
      expect(resumeB.exit).toBe(1);
      expect(resumeB.stdout).toContain("NO HANDOFF FOUND");
      expect(resumeB.stdout).not.toContain("project A work");

      // Project A can still resume its own handoff.
      const resumeA = await run(["resume"], repoA, home);
      expect(resumeA.exit).toBe(0);
      expect(resumeA.stdout).toContain("project A work");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repoA, { recursive: true, force: true });
      await rm(repoB, { recursive: true, force: true });
    }
  });

  test("legacy global store is resumable once, then the project-scoped store takes over", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-handoff-home-"));
    const repo = await makeRepo("legacy");
    try {
      // Simulate a pre-migration handoff sitting in the old flat global dir.
      const legacyDir = join(home, ".claude", "handoffs");
      await mkdir(legacyDir, { recursive: true });
      const legacyMd = join(legacyDir, "handoff_legacy.md");
      const legacyJson = join(legacyDir, "handoff_legacy.json");
      await writeFile(legacyMd, "# Session Handoff - legacy\n\nlegacy content\n");
      await writeFile(legacyJson, "{}\n");
      await pointLatest(legacyDir, legacyMd, "latest.md");
      await pointLatest(legacyDir, legacyJson, "latest.json");

      // No project-scoped store exists yet -> falls back to the legacy dir.
      const resumeBefore = await run(["resume"], repo, home);
      expect(resumeBefore.exit).toBe(0);
      expect(resumeBefore.stdout).toContain("legacy content");

      // Writing a new handoff always goes to the project-scoped dir.
      await run(["create", "--summary", "fresh session"], repo, home);

      // Now the project-scoped store exists, so resume must prefer it over
      // the legacy fallback.
      const resumeAfter = await run(["resume"], repo, home);
      expect(resumeAfter.exit).toBe(0);
      expect(resumeAfter.stdout).toContain("fresh session");
      expect(resumeAfter.stdout).not.toContain("legacy content");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("handoff.ts create content (H10)", () => {
  test("automatic create (no --summary) populates git-derived best-effort content and source:auto", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-handoff-home-"));
    const repo = await makeRepo("auto");
    try {
      const { exit } = await run(["create"], repo, home);
      expect(exit).toBe(0);

      const projectDir = join(home, ".claude", "handoffs", basename(repo));
      const jsonFiles = await import("node:fs/promises").then((fs) =>
        fs.readdir(projectDir).then((names) => names.filter((n) => /^handoff_.*\.json$/.test(n))),
      );
      expect(jsonFiles.length).toBe(1);
      const raw = await readFile(join(projectDir, jsonFiles[0] as string), "utf8");
      const parsed = JSON.parse(raw) as {
        source: string;
        context: { summary: string; keyFiles: string[] };
        recentCommits: string[];
        project: { name: string; path: string };
      };
      expect(parsed.source).toBe("auto");
      expect(parsed.context.summary).toBe("");
      expect(parsed.context.keyFiles.some((f) => f.includes("README.md"))).toBe(true);
      expect(parsed.recentCommits).toContain("initial commit");
      expect(parsed.project.name).toBe(basename(repo));
      // Compare via realpath: macOS resolves TMPDIR through /private, so the
      // spawned process's process.cwd() can differ from `repo` by that prefix
      // alone even though both name the same directory.
      expect(await realpath(parsed.project.path)).toBe(await realpath(repo));
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("manual create (--summary) marks source:manual and keeps the summary text", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-handoff-home-"));
    const repo = await makeRepo("manual");
    try {
      await run(["create", "--summary", "shipped the thing"], repo, home);
      const projectDir = join(home, ".claude", "handoffs", basename(repo));
      const jsonFiles = await import("node:fs/promises").then((fs) =>
        fs.readdir(projectDir).then((names) => names.filter((n) => /^handoff_.*\.json$/.test(n))),
      );
      const raw = await readFile(join(projectDir, jsonFiles[0] as string), "utf8");
      const parsed = JSON.parse(raw) as { source: string; context: { summary: string } };
      expect(parsed.source).toBe("manual");
      expect(parsed.context.summary).toBe("shipped the thing");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });
});
