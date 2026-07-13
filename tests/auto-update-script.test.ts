// Tests for src/scripts/auto-update.ts. Spawns the real script with HOME
// sandboxed to a temp dir — same pattern as tests/freeze.test.ts and
// tests/tool-cadence.test.ts — so the writeState() breadcrumb write
// (hook-runtime.ts's TMP_DIR is always real-HOME-derived, not parameterized)
// never touches the developer/CI machine's actual ~/.claude/tmp.
//
// Every fabricated "remote" is a local git repo on disk — zero network
// access in any test. None of these cases reach the setup.sh spawn path:
// no-repo/dirty-tree short-circuit before any git network op, and
// blocked-origin/blocked-path short-circuit before the pull itself — the
// origin allowlist and CC_EXPECTED_REPO path pin (see src/lib/schedule.ts,
// SECURITY.md) must reject a forged repo_path before any pull or install.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const AUTO_UPDATE_SCRIPT = resolve(import.meta.dir, "..", "src", "scripts", "auto-update.ts");

interface GitResult {
  exit: number;
  stdout: string;
  stderr: string;
}

async function git(args: string[], cwd: string): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  if (exit !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${stderr}`);
  return { exit, stdout, stderr };
}

async function writeSentinel(fakeHome: string, repoPath: string | undefined): Promise<void> {
  const claudeDir = join(fakeHome, ".claude");
  await mkdir(claudeDir, { recursive: true });
  await Bun.write(
    join(claudeDir, ".cc-settings-version"),
    JSON.stringify({
      version: "1.0.0",
      installed_at: new Date().toISOString(),
      installer: "src/setup.ts",
      ...(repoPath !== undefined ? { repo_path: repoPath } : {}),
    }),
  );
}

async function runAutoUpdateScript(fakeHome: string): Promise<{ exit: number; stderr: string }> {
  const proc = Bun.spawn(["bun", AUTO_UPDATE_SCRIPT], {
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { exit, stderr };
}

async function readLastRun(fakeHome: string): Promise<{
  at: string;
  status: string;
  fromVersion: string | null;
  toVersion: string | null;
} | null> {
  try {
    const raw = await readFile(
      join(fakeHome, ".claude", "tmp", "auto-update-last-run.json"),
      "utf8",
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

describe("runAutoUpdate (via src/scripts/auto-update.ts)", () => {
  test(
    "missing repo → status no-repo, exits cleanly (0)",
    async () => {
      const fakeHome = await mkdtemp(join(tmpdir(), "cc-autoupdate-norepo-"));
      try {
        await writeSentinel(fakeHome, join(fakeHome, "does-not-exist"));
        const result = await runAutoUpdateScript(fakeHome);
        expect(result.exit).toBe(0);

        const lastRun = await readLastRun(fakeHome);
        expect(lastRun?.status).toBe("no-repo");
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
      }
    },
    { timeout: 30_000 },
  );

  test(
    "missing repo_path field entirely → status no-repo, exits cleanly (0)",
    async () => {
      const fakeHome = await mkdtemp(join(tmpdir(), "cc-autoupdate-norepo2-"));
      try {
        await writeSentinel(fakeHome, undefined);
        const result = await runAutoUpdateScript(fakeHome);
        expect(result.exit).toBe(0);

        const lastRun = await readLastRun(fakeHome);
        expect(lastRun?.status).toBe("no-repo");
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
      }
    },
    { timeout: 30_000 },
  );

  test(
    "dirty tree → status skipped-dirty, never reaches git pull",
    async () => {
      const fakeHome = await mkdtemp(join(tmpdir(), "cc-autoupdate-dirty-"));
      const repoDir = await mkdtemp(join(tmpdir(), "cc-autoupdate-dirty-repo-"));
      try {
        await git(["init", "-b", "main"], repoDir);
        await git(["config", "user.email", "test@example.com"], repoDir);
        await git(["config", "user.name", "Test"], repoDir);
        await writeFile(join(repoDir, "README.md"), "# fixture\n");
        await git(["add", "."], repoDir);
        await git(["commit", "-m", "init"], repoDir);
        // Uncommitted change → `git status --porcelain` is non-empty.
        await writeFile(join(repoDir, "README.md"), "# fixture (dirty)\n");

        await writeSentinel(fakeHome, repoDir);
        const result = await runAutoUpdateScript(fakeHome);
        expect(result.exit).toBe(0);

        const lastRun = await readLastRun(fakeHome);
        expect(lastRun?.status).toBe("skipped-dirty");
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
        await rm(repoDir, { recursive: true, force: true });
      }
    },
    { timeout: 30_000 },
  );

  test(
    "clean + non-github origin → status blocked-origin, never pulls, never spawns setup.sh",
    async () => {
      // SECURITY (FIX 1): a forged repo_path could point at any repo with a
      // clean --ff-only history against itself. The origin allowlist
      // (isAllowedPullSource) must reject anything that isn't the real
      // darkroomengineering/cc-settings repo over HTTPS BEFORE any pull or
      // setup.sh spawn — regardless of how clean the local repo's tree is.
      // `git remote get-url origin` reads the configured value without
      // contacting it, so a nonexistent path is sufficient here — zero
      // network in this test.
      const fakeHome = await mkdtemp(join(tmpdir(), "cc-autoupdate-blocked-"));
      const repoDir = await mkdtemp(join(tmpdir(), "cc-autoupdate-blocked-repo-"));
      try {
        await git(["init", "-b", "main"], repoDir);
        await git(["config", "user.email", "test@example.com"], repoDir);
        await git(["config", "user.name", "Test"], repoDir);
        await writeFile(join(repoDir, "README.md"), "# fixture\n");
        await git(["add", "."], repoDir);
        await git(["commit", "-m", "init"], repoDir);
        await git(["remote", "add", "origin", "/tmp/attacker-controlled-repo"], repoDir);

        await writeSentinel(fakeHome, repoDir);
        const result = await runAutoUpdateScript(fakeHome);
        expect(result.exit).toBe(0);

        const lastRun = await readLastRun(fakeHome);
        expect(lastRun?.status).toBe("blocked-origin");

        // The log must show the allowlist rejection, never a "running
        // setup.sh" or "already up to date" line — either would mean the
        // guard was bypassed and a pull/install was attempted.
        const logRaw = await readFile(
          join(fakeHome, ".claude", "logs", "auto-update.log"),
          "utf8",
        ).catch(() => "");
        expect(logRaw).toContain("blocked");
        expect(logRaw).not.toContain("running setup.sh");
        expect(logRaw).not.toContain("already up to date");
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
        await rm(repoDir, { recursive: true, force: true });
      }
    },
    { timeout: 30_000 },
  );

  test(
    "clean + CC_EXPECTED_REPO mismatch → status blocked-path, never pulls, never spawns setup.sh",
    async () => {
      // SECURITY (FIX 1b): the plist-embedded repo-path pin. Even if the
      // origin were allowlisted, a repo_path that doesn't match the path
      // pinned at enrollment time must be rejected — a second, independent
      // surface an attacker has to compromise.
      const fakeHome = await mkdtemp(join(tmpdir(), "cc-autoupdate-pathpin-"));
      const repoDir = await mkdtemp(join(tmpdir(), "cc-autoupdate-pathpin-repo-"));
      const otherDir = await mkdtemp(join(tmpdir(), "cc-autoupdate-pathpin-other-"));
      try {
        await git(["init", "-b", "main"], repoDir);
        await git(["config", "user.email", "test@example.com"], repoDir);
        await git(["config", "user.name", "Test"], repoDir);
        await writeFile(join(repoDir, "README.md"), "# fixture\n");
        await git(["add", "."], repoDir);
        await git(["commit", "-m", "init"], repoDir);
        await git(
          ["remote", "add", "origin", "https://github.com/darkroomengineering/cc-settings"],
          repoDir,
        );

        await writeSentinel(fakeHome, repoDir);

        const proc = Bun.spawn(["bun", AUTO_UPDATE_SCRIPT], {
          env: {
            ...process.env,
            HOME: fakeHome,
            USERPROFILE: fakeHome,
            CC_EXPECTED_REPO: otherDir,
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        await new Response(proc.stdout).text();
        await new Response(proc.stderr).text();
        const exit = await proc.exited;
        expect(exit).toBe(0);

        const lastRun = await readLastRun(fakeHome);
        expect(lastRun?.status).toBe("blocked-path");

        const logRaw = await readFile(
          join(fakeHome, ".claude", "logs", "auto-update.log"),
          "utf8",
        ).catch(() => "");
        expect(logRaw).toContain("blocked");
        expect(logRaw).not.toContain("running setup.sh");
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
        await rm(repoDir, { recursive: true, force: true });
        await rm(otherDir, { recursive: true, force: true });
      }
    },
    { timeout: 30_000 },
  );
});
