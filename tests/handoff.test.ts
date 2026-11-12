// handoff.ts CLI regressions:
//   - H11: the handoff store is scoped per project, not
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
// repo — same pattern as tests/freeze.test.ts.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pointLatest } from "../src/lib/artifact-store.ts";
import { GIT_ISOLATION_ENV, git, makeRepo as makeGitRepo } from "./support/git.ts";
import { spawnCapture } from "./support/proc.ts";

const SCRIPT = resolve(import.meta.dir, "..", "src", "scripts", "handoff.ts");

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

// One uncommitted change so git status --porcelain / modifiedFiles is non-empty.
async function makeRepo(name: string): Promise<string> {
  return makeGitRepo(`cc-handoff-${name}`, { uncommittedChange: "hello again\n" });
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

describe("handoff.ts treats stored handoffs as untrusted", () => {
  test("symlinked and path-traversing handoffs are not listed or resumable", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-handoff-home-"));
    const repo = await makeRepo("untrusted");
    try {
      await run(["create", "--summary", "real work"], repo, home);
      const projectDir = join(home, ".claude", "handoffs", basename(repo));
      const secret = join(home, "secret.md");
      await writeFile(secret, "# Session Handoff - outside\n\nsecret outside content\n");
      await symlink(secret, join(projectDir, "handoff_evil.md"));

      const list = await run(["list"], repo, home);
      expect(list.stdout).not.toContain("evil");
      expect(list.stdout).toContain("(latest)");

      const viaSymlink = await run(["resume", "evil"], repo, home);
      expect(viaSymlink.exit).toBe(1);
      expect(viaSymlink.stdout).not.toContain("secret outside content");

      const viaTraversal = await run(["resume", "../../../secret"], repo, home);
      expect(viaTraversal.exit).toBe(1);
      expect(viaTraversal.stdout).not.toContain("secret outside content");

      const latest = await run(["resume"], repo, home);
      expect(latest.exit).toBe(0);
      expect(latest.stdout).toContain("real work");
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

describe("handoff.ts records HEAD and a tree fingerprint, and resume compares against them", () => {
  // Creates a handoff, applies `change` to the repo, then resumes and returns
  // the "Since handoff" block of the resume output.
  async function sinceHandoff(
    name: string,
    change: (repo: string) => Promise<void>,
    setup: (repo: string) => Promise<void> = async () => {},
  ): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), "cc-handoff-home-"));
    const repo = await makeRepo(name);
    try {
      await setup(repo);
      const created = await run(["create", "--summary", "fingerprinted"], repo, home);
      expect(created.exit).toBe(0);
      await change(repo);
      const resumed = await run(["resume"], repo, home);
      expect(resumed.exit).toBe(0);
      const start = resumed.stdout.indexOf("Since handoff:");
      expect(start).toBeGreaterThan(-1);
      return resumed.stdout.slice(start, resumed.stdout.indexOf("# Session Handoff", start));
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  }

  test("create stores the full HEAD SHA and a sha256 fingerprint in the JSON and Markdown", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-handoff-home-"));
    const repo = await makeRepo("fp-record");
    try {
      await run(["create"], repo, home);
      const projectDir = join(home, ".claude", "handoffs", basename(repo));
      const parsed = JSON.parse(await readFile(join(projectDir, "latest.json"), "utf8")) as {
        git: { head: string; treeFingerprint: string; treePaths: Record<string, string> };
      };
      expect(parsed.git.head).toMatch(/^[0-9a-f]{40}$/);
      expect(parsed.git.treeFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(parsed.git.treePaths)).toEqual(["README.md"]);
      const md = await readFile(join(projectDir, "latest.md"), "utf8");
      expect(md).toContain(`- **HEAD:** ${parsed.git.head}`);
      expect(md).toContain(`- **Tree:** ${parsed.git.treeFingerprint.slice(0, 16)}`);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("nothing changed: unchanged since handoff", async () => {
    const out = await sinceHandoff("fp-stable", async () => {});
    expect(out).toContain("Since handoff: unchanged since handoff");
  });

  test("an edit to a tracked file changes the fingerprint and names the path", async () => {
    const out = await sinceHandoff("fp-tracked", (repo) =>
      writeFile(join(repo, "README.md"), "edited after the handoff\n"),
    );
    expect(out).toContain("Since handoff: working tree changed since handoff");
    expect(out).toContain("  - README.md");
  });

  test("a new untracked file changes the fingerprint and names the path", async () => {
    const out = await sinceHandoff("fp-untracked", (repo) =>
      writeFile(join(repo, "notes.txt"), "new file\n"),
    );
    expect(out).toContain("Since handoff: working tree changed since handoff");
    expect(out).toContain("  - notes.txt");
    expect(out).not.toContain("README.md");
  });

  test("an ignored file does not affect the fingerprint", async () => {
    const out = await sinceHandoff(
      "fp-ignored",
      (repo) => writeFile(join(repo, "debug.log"), "noise\n"),
      (repo) => writeFile(join(repo, ".gitignore"), "*.log\n"),
    );
    expect(out).toContain("Since handoff: unchanged since handoff");
  });

  test("new commits report HEAD moved with the range and commit count", async () => {
    const out = await sinceHandoff("fp-head", async (repo) => {
      await git(repo, ["commit", "-q", "-am", "second"]);
      await writeFile(join(repo, "more.txt"), "more\n");
      await git(repo, ["add", "-A"]);
      await git(repo, ["commit", "-q", "-m", "third"]);
    });
    expect(out).toMatch(/Since handoff: HEAD moved: [0-9a-f]{12}\.\.[0-9a-f]{12} \(2 commits\)/);
    expect(out).not.toContain("working tree changed");
  });

  test("a handoff written without a fingerprint still resumes", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-handoff-home-"));
    const repo = await makeRepo("fp-legacy");
    try {
      const projectDir = join(home, ".claude", "handoffs", basename(repo));
      await mkdir(projectDir, { recursive: true });
      const md = join(projectDir, "handoff_20250101_000000.md");
      const json = join(projectDir, "handoff_20250101_000000.json");
      await writeFile(md, "# Session Handoff - old\n\nold handoff content\n");
      await writeFile(json, `${JSON.stringify({ git: { branch: "main", pendingChanges: 1 } })}\n`);
      await pointLatest(projectDir, md, "latest.md");
      await pointLatest(projectDir, json, "latest.json");

      const resumed = await run(["resume"], repo, home);
      expect(resumed.exit).toBe(0);
      expect(resumed.stdout).toContain("Since handoff: no fingerprint recorded");
      expect(resumed.stdout).toContain("old handoff content");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });
});
