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
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gitBashPath, prependTestPath } from "./support/portable-process.ts";

const AUTO_UPDATE_SCRIPT = resolve(import.meta.dir, "..", "src", "scripts", "auto-update.ts");

// Fixture repos must never inherit the developer/CI machine's ambient git
// config (commit.gpgsign + a signing program, core.hooksPath, aliases, ...).
// Nulling both config files is what actually isolates everything in one
// place; per-repo user.email/user.name (set below) remain the only identity
// available once the global/system files are gone.
const GIT_ISOLATION_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

interface GitResult {
  exit: number;
  stdout: string;
  stderr: string;
}

async function git(args: string[], cwd: string): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    env: { ...process.env, ...GIT_ISOLATION_ENV },
    stdout: "pipe",
    stderr: "pipe",
  });
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

async function runAutoUpdateScript(
  fakeHome: string,
  extraEnv: Record<string, string> = {},
): Promise<{ exit: number; stderr: string }> {
  const proc = Bun.spawn([process.execPath, AUTO_UPDATE_SCRIPT], {
    env: {
      ...process.env,
      ...GIT_ISOLATION_ENV,
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      ...extraEnv,
    },
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

  test.each(["ahead", "diverged"] as const)(
    "clean official-origin checkout with %s history is blocked before setup",
    async (history) => {
      const fakeHome = await mkdtemp(join(tmpdir(), "cc-autoupdate-history-home-"));
      const repoDir = await mkdtemp(join(tmpdir(), "cc-autoupdate-history-repo-"));
      const binDir = join(fakeHome, "bin");
      const gitLog = join(fakeHome, "git.log");
      try {
        await mkdir(join(repoDir, ".git"), { recursive: true });
        await mkdir(join(repoDir, ".git", "refs", "heads"), { recursive: true });
        await mkdir(binDir, { recursive: true });
        await writeFile(join(repoDir, "package.json"), '{"version":"1.0.0"}\n');
        await writeFile(join(repoDir, "setup.sh"), "#!/bin/sh\ntouch setup-ran\n");
        await writeFile(
          join(repoDir, ".git", "config"),
          '[remote "origin"]\n  url = https://github.com/darkroomengineering/cc-settings.git\n',
        );
        await writeFile(join(repoDir, ".git", "HEAD"), "ref: refs/heads/main\n");
        await writeFile(join(repoDir, ".git", "refs", "heads", "main"), `${"2".repeat(40)}\n`);
        await writeFile(join(repoDir, ".git", "index"), "fixture\n");
        await writeFile(
          join(binDir, "git"),
          `#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_GIT_LOG"
case " $* " in
  *" config --file "*" remote.origin.url "*) printf 'https://github.com/darkroomengineering/cc-settings.git\n' ;;
  *" clone "*)
    destination="\${!#}"
    mkdir -p "$destination/.git/refs/heads" "$destination/.claude-plugin"
    cp "$FAKE_REPO/package.json" "$destination/package.json"
    cp "$FAKE_REPO/setup.sh" "$destination/setup.sh"
    printf '[remote "origin"]\n  url = https://github.com/darkroomengineering/cc-settings.git\n' > "$destination/.git/config"
    printf 'ref: refs/heads/main\n' > "$destination/.git/HEAD"
    printf '${"1".repeat(40)}\n' > "$destination/.git/refs/heads/main"
    printf fixture > "$destination/.git/index"
    ;;
  *" rev-parse HEAD "*) printf '${"1".repeat(40)}\n' ;;
  *" merge-base --is-ancestor "*) exit 1 ;;
  *) exit 2 ;;
esac
`,
        );
        await chmod(join(binDir, "git"), 0o755);
        await writeSentinel(fakeHome, repoDir);

        const result = await runAutoUpdateScript(fakeHome, {
          PATH: prependTestPath(binDir),
          FAKE_GIT_LOG: gitBashPath(gitLog),
          FAKE_HISTORY: history,
          FAKE_REPO: gitBashPath(repoDir),
        });

        expect(result.exit).toBe(1);
        expect((await readLastRun(fakeHome))?.status).toBe("blocked-history");
        expect(await readFile(gitLog, "utf8")).toContain("merge-base --is-ancestor");
        expect(await readFile(join(repoDir, "setup-ran"), "utf8").catch(() => null)).toBeNull();
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
        await rm(repoDir, { recursive: true, force: true });
      }
    },
    { timeout: 30_000 },
  );

  test(
    "an older enrolled checkout does not reinstall when the installed version matches official main",
    async () => {
      const fakeHome = await mkdtemp(join(tmpdir(), "cc-autoupdate-official-home-"));
      const repoDir = await mkdtemp(join(tmpdir(), "cc-autoupdate-official-repo-"));
      const binDir = join(fakeHome, "bin");
      const gitLog = join(fakeHome, "git.log");
      try {
        await mkdir(join(repoDir, ".git"), { recursive: true });
        await mkdir(join(repoDir, ".git", "refs", "heads"), { recursive: true });
        await mkdir(binDir, { recursive: true });
        await writeFile(join(repoDir, "package.json"), '{"version":"1.0.0"}\n');
        await writeFile(join(repoDir, "setup.sh"), "#!/bin/sh\nexit 0\n");
        await writeFile(
          join(repoDir, ".git", "config"),
          '[remote "origin"]\n  url = https://github.com/darkroomengineering/cc-settings.git\n',
        );
        await writeFile(join(repoDir, ".git", "HEAD"), "ref: refs/heads/main\n");
        await writeFile(join(repoDir, ".git", "refs", "heads", "main"), `${"0".repeat(40)}\n`);
        await writeFile(join(repoDir, ".git", "index"), "fixture\n");
        await writeFile(
          join(binDir, "git"),
          `#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_GIT_LOG"
case " $* " in
  *" config --file "*" remote.origin.url "*) printf 'https://github.com/darkroomengineering/cc-settings.git\n' ;;
  *" clone "*)
    destination="\${!#}"
    mkdir -p "$destination/.git/refs/heads"
    cp "$FAKE_REPO/package.json" "$destination/package.json"
    cp "$FAKE_REPO/setup.sh" "$destination/setup.sh"
    printf '[remote "origin"]\n  url = https://github.com/darkroomengineering/cc-settings.git\n' > "$destination/.git/config"
    printf 'ref: refs/heads/main\n' > "$destination/.git/HEAD"
    printf '${"1".repeat(40)}\n' > "$destination/.git/refs/heads/main"
    printf fixture > "$destination/.git/index"
    ;;
  *" rev-parse HEAD "*) printf '${"1".repeat(40)}\n' ;;
  *" merge-base --is-ancestor "*|*" read-tree "*|*" diff-files --quiet "*|*" ls-files --others "*|*" diff-index --cached "*|*" checkout -B main "*|*" merge --ff-only "*) ;;
  *) exit 2 ;;
esac
`,
        );
        await chmod(join(binDir, "git"), 0o755);
        await writeSentinel(fakeHome, repoDir);

        const result = await runAutoUpdateScript(fakeHome, {
          PATH: prependTestPath(binDir),
          FAKE_GIT_LOG: gitBashPath(gitLog),
          FAKE_REPO: gitBashPath(repoDir),
        });

        expect(result.exit).toBe(0);
        expect((await readLastRun(fakeHome))?.status).toBe("up-to-date");
        const commands = await readFile(gitLog, "utf8");
        expect(commands).toContain("clone --branch main --single-branch");
        expect(commands).toContain("merge --ff-only");
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
        await rm(repoDir, { recursive: true, force: true });
      }
    },
    { timeout: 30_000 },
  );

  test(
    "mutable Git config is never executed and the enrolled checkout metadata is preserved",
    async () => {
      const fakeHome = await mkdtemp(join(tmpdir(), "cc-autoupdate-isolated-home-"));
      const repoDir = await mkdtemp(join(tmpdir(), "cc-autoupdate-isolated-repo-"));
      const binDir = join(fakeHome, "bin");
      const gitLog = join(fakeHome, "git.log");
      const marker = join(fakeHome, "mutable-config-ran");
      const stagedSetup = join(fakeHome, "staged-setup.sh");
      const oldHead = "1".repeat(40);
      const newHead = "2".repeat(40);
      try {
        await mkdir(join(repoDir, ".git", "refs", "heads"), { recursive: true });
        await mkdir(join(repoDir, ".git", "refs", "tags"), { recursive: true });
        await mkdir(join(repoDir, ".git", "logs"), { recursive: true });
        await mkdir(binDir, { recursive: true });
        await writeFile(join(repoDir, ".git", "HEAD"), "ref: refs/heads/main\n");
        await writeFile(join(repoDir, ".git", "refs", "heads", "main"), `${oldHead}\n`);
        await writeFile(join(repoDir, ".git", "refs", "heads", "local-only"), `${oldHead}\n`);
        await writeFile(join(repoDir, ".git", "refs", "tags", "local-tag"), `${oldHead}\n`);
        await writeFile(join(repoDir, ".git", "logs", "HEAD"), "local reflog\n");
        await writeFile(join(repoDir, ".git", "index"), "fixture\n");
        await writeFile(join(repoDir, "ignored-local.txt"), "keep me\n");
        await writeFile(join(repoDir, "package.json"), '{"version":"1.0.0"}\n');
        await writeFile(
          join(repoDir, ".git", "config"),
          `[core]\n  fsmonitor = ${marker}\n[filter "attack"]\n  clean = ${marker}\n[url "https://attacker.invalid/"]\n  insteadOf = https://github.com/\n[http]\n  proxy = http://attacker.invalid\n  sslVerify = false\n[remote "origin"]\n  url = https://github.com/darkroomengineering/cc-settings.git\n`,
        );
        await writeFile(
          stagedSetup,
          `#!/bin/bash
printf '%s\n%s\n' "$CC_SETTINGS_ENROLLED_REPO" "$CC_EXPECTED_REPO" > "$HOME/setup-env"
printf '{"version":"2.0.0","repo_path":"%s","auto_update":true}\n' "$CC_SETTINGS_ENROLLED_REPO" > "$HOME/.claude/.cc-settings-version"
`,
        );
        const realGit = new TextDecoder().decode(Bun.spawnSync(["which", "git"]).stdout).trim();
        await writeFile(
          join(binDir, "git"),
          `#!/usr/bin/env bash
printf '%s|%s|%s|%s|%s\n' "$GIT_CONFIG_GLOBAL" "$GIT_CONFIG_SYSTEM" "$GIT_SSL_NO_VERIFY" "$GIT_EXEC_PATH" "$*" >> "$FAKE_GIT_LOG"
case " $* " in
  *" config --file "*" remote.origin.url "*) exec "$REAL_GIT" "$@" ;;
  *" clone "*)
    destination="\${!#}"
    mkdir -p "$destination/.git/refs/heads" "$destination/.claude-plugin"
    cp "$FAKE_SETUP" "$destination/setup.sh"
    printf '{"version":"2.0.0"}\n' > "$destination/package.json"
    printf '{"version":"2.0.0"}\n' > "$destination/.claude-plugin/plugin.json"
    printf 'ref: refs/heads/main\n' > "$destination/.git/HEAD"
    printf '%s\n' "$FAKE_NEW_HEAD" > "$destination/.git/refs/heads/main"
    ;;
  *" rev-parse HEAD "*) printf '%s\n' "$FAKE_NEW_HEAD" ;;
  *" merge-base --is-ancestor "*|*" read-tree "*|*" diff-files --quiet "*|*" ls-files --others "*|*" diff-index --cached "*|*" checkout -B main "*|*" merge --ff-only "*) ;;
  *) exit 2 ;;
esac
`,
        );
        await chmod(join(binDir, "git"), 0o755);
        await writeSentinel(fakeHome, repoDir);

        const result = await runAutoUpdateScript(fakeHome, {
          PATH: prependTestPath(binDir),
          FAKE_GIT_LOG: gitBashPath(gitLog),
          FAKE_SETUP: gitBashPath(stagedSetup),
          FAKE_NEW_HEAD: newHead,
          REAL_GIT: gitBashPath(realGit),
          GIT_SSL_NO_VERIFY: "1",
          GIT_EXEC_PATH: join(fakeHome, "attacker-git-exec-path"),
        });

        expect(result.exit).toBe(0);
        expect((await readLastRun(fakeHome))?.status).toBe("updated");
        expect(await readFile(marker, "utf8").catch(() => null)).toBeNull();
        expect(await readFile(join(repoDir, "ignored-local.txt"), "utf8")).toBe("keep me\n");
        expect(await readFile(join(repoDir, ".git", "refs", "heads", "local-only"), "utf8")).toBe(
          `${oldHead}\n`,
        );
        expect(await readFile(join(repoDir, ".git", "refs", "tags", "local-tag"), "utf8")).toBe(
          `${oldHead}\n`,
        );
        expect(await readFile(join(repoDir, ".git", "logs", "HEAD"), "utf8")).toBe(
          "local reflog\n",
        );
        expect(await readFile(join(fakeHome, "setup-env"), "utf8")).toBe(
          `${repoDir}\n${repoDir}\n`,
        );
        expect((await readLastRun(fakeHome))?.toVersion).toBe("2.0.0");
        const commands = await readFile(gitLog, "utf8");
        expect(commands).toContain("/dev/null|/dev/null|||");
        expect(commands).not.toContain(` -C ${repoDir} `);
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
        await rm(repoDir, { recursive: true, force: true });
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

  test.each(["dirty", "git-error"] as const)(
    "%s result from isolated worktree check fails closed",
    async (mode) => {
      const fakeHome = await mkdtemp(join(tmpdir(), "cc-autoupdate-dirty-"));
      const repoDir = await mkdtemp(join(tmpdir(), "cc-autoupdate-dirty-repo-"));
      const binDir = join(fakeHome, "bin");
      try {
        await git(["init", "-b", "main"], repoDir);
        await git(["config", "user.email", "test@example.com"], repoDir);
        await git(["config", "user.name", "Test"], repoDir);
        await writeFile(join(repoDir, "README.md"), "# fixture\n");
        await git(["add", "."], repoDir);
        await git(["commit", "-m", "init"], repoDir);
        // Uncommitted change → `git status --porcelain` is non-empty.
        await writeFile(join(repoDir, "README.md"), "# fixture (dirty)\n");
        const head = (await git(["rev-parse", "HEAD"], repoDir)).stdout.trim();
        await mkdir(binDir, { recursive: true });
        await writeFile(
          join(binDir, "git"),
          `#!/usr/bin/env bash
case " $* " in
  *" config --file "*" remote.origin.url "*) printf 'https://github.com/darkroomengineering/cc-settings.git\n' ;;
  *" clone "*) destination="\${!#}"; mkdir -p "$destination/.git" ;;
  *" rev-parse HEAD "*) printf '%s\n' "$FAKE_HEAD" ;;
  *" merge-base --is-ancestor "*|*" read-tree "*) ;;
  *" diff-files --quiet "*) exit "$FAKE_DIFF_EXIT" ;;
  *" ls-files --others "*) ;;
  *) exit 2 ;;
esac
`,
        );
        await chmod(join(binDir, "git"), 0o755);

        await writeSentinel(fakeHome, repoDir);
        const result = await runAutoUpdateScript(fakeHome, {
          PATH: prependTestPath(binDir),
          FAKE_HEAD: head,
          FAKE_DIFF_EXIT: mode === "dirty" ? "1" : "2",
        });
        expect(result.exit).toBe(mode === "dirty" ? 0 : 1);

        const lastRun = await readLastRun(fakeHome);
        expect(lastRun?.status).toBe(mode === "dirty" ? "skipped-dirty" : "pull-failed");
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

        const proc = Bun.spawn([process.execPath, AUTO_UPDATE_SCRIPT], {
          env: {
            ...process.env,
            ...GIT_ISOLATION_ENV,
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
