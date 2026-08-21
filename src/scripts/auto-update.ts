#!/usr/bin/env bun
// Nightly auto-update job — run by the launchd job registered by
// registerAutoUpdate() (src/lib/schedule.ts). Pulls the cc-settings repo and
// re-runs the installer non-interactively.
//
// Enrollment is never touched here: setup.sh is spawned with stdin:"ignore",
// so isInteractive() is false, and decideAutoUpdate() keeps whatever was
// previously decided (see src/lib/schedule.ts) — a nightly unattended run
// can never silently enroll or unenroll anyone.
//
// No auto-rollback on failure — human-in-the-loop, matching SECURITY.md's
// "don't auto-remediate" philosophy for anything that touches settings.
//
// SECURITY: `repo_path` in ~/.claude/.cc-settings-version is UNAUTHENTICATED
// (see SECURITY.md) — a compromised package could write it, plant a `.git`
// with an attacker origin, and turn this nightly job into arbitrary code
// execution. Two independent gates below defend against that: an origin
// allowlist (isAllowedPullSource — the pull source must resolve to the real
// darkroomengineering/cc-settings repo over HTTPS) and, when the enrolling
// plist embedded it, a CC_EXPECTED_REPO path pin that the sentinel's
// repo_path must match. Both must pass before any pull or setup.sh spawn.

import { closeSync, existsSync, openSync, realpathSync } from "node:fs";
import { appendFile, copyFile, lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writeState } from "../lib/hook-runtime.ts";
import { CLAUDE_DIR, isoNow } from "../lib/platform.ts";
import { autoUpdateLogPath, isAllowedPullSource } from "../lib/schedule.ts";
import {
  computeDrift,
  readInstalledVersion,
  readPackagedVersion,
  readSentinelInfo,
} from "../lib/version-delta.ts";
import { sendNotification } from "./notify.ts";

type RunStatus =
  | "up-to-date"
  | "updated"
  | "skipped-dirty"
  | "pull-failed"
  | "setup-failed"
  | "no-repo"
  | "blocked-origin"
  | "blocked-history"
  | "blocked-path";

let logDirEnsured = false;

async function log(msg: string): Promise<void> {
  const logPath = autoUpdateLogPath();
  if (!logDirEnsured) {
    await mkdir(dirname(logPath), { recursive: true }).catch(() => {});
    logDirEnsured = true;
  }
  await appendFile(logPath, `[${isoNow()}] ${msg}\n`).catch(() => {});
}

/**
 * Rewrite a generic SSH GitHub-style origin (`git@host:owner/repo.git`) to
 * HTTPS — launchd runs with no ssh-agent, so an SSH origin would hang/fail
 * the pull. Leaves an already-HTTPS origin as-is. Returns null (not a bare
 * remote name) when the input can't be resolved to a concrete HTTPS URL —
 * a bare remote name like "origin" can't be verified against the origin
 * allowlist, so treating it as a fallback would defeat that gate.
 */
export function resolvePullSource(originUrl: string): string | null {
  const trimmed = originUrl.trim();
  if (!trimmed) return null;
  if (/^https:\/\//.test(trimmed)) return trimmed;
  const m = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(trimmed);
  if (m) return `https://${m[1]}/${m[2]}.git`;
  return null;
}

interface GitResult {
  exit: number;
  stdout: string;
  stderr: string;
}

const SAFE_GIT_CONFIG = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.attributesFile=/dev/null",
  "-c",
  "credential.helper=",
  "-c",
  "http.proxy=",
  "-c",
  "http.sslVerify=true",
] as const;

async function runIsolatedGit(
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<GitResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    ...extraEnv,
  });

  const proc = Bun.spawn(["git", ...SAFE_GIT_CONFIG, ...args], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exit, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function readManagedHead(repoPath: string): Promise<string | null> {
  const gitDir = join(repoPath, ".git");
  const headPath = join(gitDir, "HEAD");
  const headStat = await lstat(headPath).catch(() => null);
  if (!headStat?.isFile() || headStat.isSymbolicLink()) return null;

  const head = (await readFile(headPath, "utf8")).trim();
  if (/^[0-9a-f]{40}$/i.test(head)) return head;
  if (!head.startsWith("ref: ")) return null;

  const ref = head.slice(5);
  if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(ref) || ref.includes("..") || ref.includes("//")) {
    return null;
  }

  const refPath = join(gitDir, ref);
  const refStat = await lstat(refPath).catch(() => null);
  if (refStat?.isFile() && !refStat.isSymbolicLink()) {
    const hash = (await readFile(refPath, "utf8")).trim();
    return /^[0-9a-f]{40}$/i.test(hash) ? hash : null;
  }

  const packedPath = join(gitDir, "packed-refs");
  const packedStat = await lstat(packedPath).catch(() => null);
  if (!packedStat?.isFile() || packedStat.isSymbolicLink()) return null;
  const matches = (await readFile(packedPath, "utf8"))
    .split("\n")
    .map((line) => line.trim().split(/\s+/, 2))
    .filter(
      (parts) => parts.length === 2 && parts[1] === ref && /^[0-9a-f]{40}$/i.test(parts[0] ?? ""),
    );
  return matches.length === 1 ? (matches[0]?.[0] ?? null) : null;
}

export async function runAutoUpdate(claudeDir: string = CLAUDE_DIR): Promise<void> {
  let fromVersion: string | null = null;
  let toVersion: string | null = null;
  let status: RunStatus = "no-repo";
  let stagingPath: string | null = null;

  try {
    await log("starting");
    fromVersion = await readInstalledVersion(claudeDir);

    const { repoPath } = await readSentinelInfo(claudeDir);
    if (!repoPath || !existsSync(join(repoPath, ".git"))) {
      status = "no-repo";
      await log(`no repo at ${repoPath ?? "(unset)"} — skipping`);
      await sendNotification("cc-settings auto-update skipped — repo not found");
      return;
    }

    // Gate (b): the plist-embedded repo-path pin. Only enforced when the
    // enrolling registerAutoUpdate() embedded it (CC_EXPECTED_REPO set) —
    // a legacy plist without the pin skips this gate and relies solely on
    // the origin allowlist below. Both existsSync checks short-circuit the
    // realpathSync calls so a missing path can never throw here.
    const expectedRepo = process.env.CC_EXPECTED_REPO;
    if (expectedRepo) {
      const expectedExists = existsSync(expectedRepo);
      if (!expectedExists || realpathSync(repoPath) !== realpathSync(expectedRepo)) {
        status = "blocked-path";
        await log(`blocked — repo path ${repoPath} does not match enrolled path ${expectedRepo}`);
        await sendNotification("auto-update blocked — repo path does not match the enrolled path");
        return;
      }
    }

    const configPath = join(repoPath, ".git", "config");
    const configStat = await lstat(configPath).catch(() => null);
    if (!configStat?.isFile() || configStat.isSymbolicLink()) {
      status = "blocked-origin";
      await log("blocked — managed checkout Git config is missing or unsafe");
      await sendNotification("auto-update blocked — managed checkout Git config is unsafe");
      process.exitCode = 1;
      return;
    }
    const origin = await runIsolatedGit([
      "config",
      "--file",
      configPath,
      "--no-includes",
      "--get-all",
      "remote.origin.url",
    ]);
    if (origin.exit !== 0 || origin.stdout.split("\n").filter(Boolean).length !== 1) {
      status = "blocked-origin";
      await log(`blocked — managed checkout origin could not be read safely: ${origin.stderr}`);
      await sendNotification("auto-update blocked — managed checkout origin is unreadable");
      process.exitCode = 1;
      return;
    }
    const originUrl = origin.stdout;
    const pullSource = resolvePullSource(originUrl);

    // Gate (a): the origin allowlist. A forged repo_path pointing at an
    // attacker-controlled clone (even one with a clean --ff-only history
    // against itself) is rejected here — only the real
    // darkroomengineering/cc-settings repo over HTTPS is ever pulled from.
    if (pullSource === null || !isAllowedPullSource(pullSource)) {
      status = "blocked-origin";
      await log(`blocked — origin '${originUrl}' is not the expected cc-settings repo`);
      await sendNotification(
        "auto-update blocked — cc-settings origin is not the expected repo (see ~/.claude/logs/auto-update.log)",
      );
      return;
    }

    const before = await readManagedHead(repoPath);
    if (!before) {
      status = "pull-failed";
      await log("blocked — managed checkout HEAD could not be read safely");
      await sendNotification("auto-update blocked — managed checkout HEAD is unreadable");
      process.exitCode = 1;
      return;
    }

    stagingPath = await mkdtemp(join(dirname(repoPath), ".source-update-"));
    const clone = await runIsolatedGit([
      "clone",
      "--branch",
      "main",
      "--single-branch",
      pullSource,
      stagingPath,
    ]);
    if (clone.exit !== 0) {
      status = "pull-failed";
      await log(`isolated git clone failed (exit ${clone.exit}): ${clone.stderr}`);
      await sendNotification(
        "auto-update failed — isolated clone error (see ~/.claude/logs/auto-update.log)",
      );
      process.exitCode = 1;
      return;
    }

    const official = await runIsolatedGit(["-C", stagingPath, "rev-parse", "HEAD"]);
    if (official.exit !== 0 || !/^[0-9a-f]{40}$/i.test(official.stdout)) {
      status = "pull-failed";
      await log(`blocked — cloned official HEAD could not be verified: ${official.stderr}`);
      await sendNotification("auto-update blocked — official checkout verification failed");
      process.exitCode = 1;
      return;
    }
    const after = official.stdout;

    const ancestry = await runIsolatedGit([
      "-C",
      stagingPath,
      "merge-base",
      "--is-ancestor",
      before,
      after,
    ]);
    if (ancestry.exit !== 0) {
      status = "blocked-history";
      await log("blocked — local checkout is ahead of or diverges from official main");
      await sendNotification("auto-update blocked — local checkout does not match official main");
      process.exitCode = 1;
      return;
    }

    const checkDir = await mkdtemp(join(dirname(repoPath), ".source-check-"));
    const generatedIndex = join(checkDir, "generated-index");
    const safeRepoArgs = ["--git-dir", join(stagingPath, ".git"), "--work-tree", repoPath];
    const readTree = await runIsolatedGit([...safeRepoArgs, "read-tree", before], {
      GIT_INDEX_FILE: generatedIndex,
    });
    if (readTree.exit !== 0) {
      status = "pull-failed";
      await log(`blocked — managed checkout state could not be verified: ${readTree.stderr}`);
      await rm(checkDir, { recursive: true, force: true });
      process.exitCode = 1;
      return;
    }
    const worktreeDiff = await runIsolatedGit([...safeRepoArgs, "diff-files", "--quiet", "--"], {
      GIT_INDEX_FILE: generatedIndex,
    });
    const untracked = await runIsolatedGit(
      [...safeRepoArgs, "ls-files", "--others", "--exclude-standard"],
      { GIT_INDEX_FILE: generatedIndex },
    );
    if (worktreeDiff.exit > 1 || untracked.exit !== 0) {
      status = "pull-failed";
      await log("blocked — Git failed while checking the managed checkout for local changes");
      await rm(checkDir, { recursive: true, force: true });
      process.exitCode = 1;
      return;
    }
    if (worktreeDiff.exit === 1 || untracked.stdout !== "") {
      status = "skipped-dirty";
      await log("skipped — uncommitted changes in cc-settings");
      await sendNotification("auto-update skipped — uncommitted changes in cc-settings");
      await rm(checkDir, { recursive: true, force: true });
      return;
    }

    const oldIndex = join(repoPath, ".git", "index");
    const oldIndexStat = await lstat(oldIndex).catch(() => null);
    if (!oldIndexStat?.isFile() || oldIndexStat.isSymbolicLink()) {
      status = "pull-failed";
      await log("blocked — managed checkout index is missing or unsafe");
      await rm(checkDir, { recursive: true, force: true });
      process.exitCode = 1;
      return;
    }
    const copiedIndex = join(checkDir, "original-index");
    await copyFile(oldIndex, copiedIndex);
    const stagedDiff = await runIsolatedGit(
      [...safeRepoArgs, "diff-index", "--cached", "--quiet", before, "--"],
      { GIT_INDEX_FILE: copiedIndex },
    );
    await rm(checkDir, { recursive: true, force: true });
    if (stagedDiff.exit === 1) {
      status = "skipped-dirty";
      await log("skipped — staged changes in cc-settings");
      await sendNotification("auto-update skipped — staged changes in cc-settings");
      return;
    }
    if (stagedDiff.exit !== 0) {
      status = "pull-failed";
      await log(`blocked — Git failed while checking the managed index: ${stagedDiff.stderr}`);
      process.exitCode = 1;
      return;
    }

    const checkout = await runIsolatedGit(["-C", stagingPath, "checkout", "-B", "main", before]);
    const merge =
      checkout.exit === 0
        ? await runIsolatedGit(["-C", stagingPath, "merge", "--ff-only", after])
        : checkout;
    const merged = await runIsolatedGit(["-C", stagingPath, "rev-parse", "HEAD"]);
    if (merge.exit !== 0 || merged.exit !== 0 || merged.stdout !== after) {
      status = "blocked-history";
      await log("blocked — isolated checkout did not land exactly on official main");
      await sendNotification("auto-update blocked — checkout verification failed");
      process.exitCode = 1;
      return;
    }

    // "Nothing to pull" is NOT the same as "install is current". The repo can
    // sit ahead of ~/.claude with no fetch to do — a local commit, a manual
    // `git pull` that was never followed by setup.sh, or an earlier run whose
    // setup failed. Gating the re-install on `before === after` made every one
    // of those cases permanently invisible: the job reported "already up to
    // date" each morning while the installed version fell further behind. Gate
    // on the version delta instead, so any drift heals on the next run.
    const packaged = await readPackagedVersion(stagingPath);
    const { stale } = computeDrift(fromVersion, packaged);

    if (!stale) {
      status = "up-to-date";
      await log(
        before === after
          ? "already up to date"
          : "installed version already matches official main; enrolled checkout left untouched",
      );
      return;
    }

    await log(
      before === after
        ? `no new commits, but installed v${fromVersion ?? "unknown"} is behind packaged v${packaged ?? "unknown"} — running setup.sh`
        : `official main advanced beyond enrolled checkout ${before} -> ${after}; installing from isolated clone`,
    );
    const logPath = autoUpdateLogPath();
    await mkdir(dirname(logPath), { recursive: true }).catch(() => {});

    // launchd provides a minimal PATH. System dirs come FIRST and the
    // user-writable ~/.bun/bin comes LAST — a planted binary earlier in a
    // user-writable dir must never shadow the real bash/git/bun. bash is
    // invoked by absolute path for the same reason (no PATH lookup at all).
    const fd = openSync(logPath, "a");
    let setupExit: number;
    try {
      const setup = Bun.spawn(["/bin/bash", "setup.sh"], {
        cwd: stagingPath,
        stdin: "ignore",
        stdout: fd,
        stderr: fd,
        timeout: 300_000,
        killSignal: "SIGKILL",
        env: {
          ...process.env,
          PATH: `/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:${homedir()}/.bun/bin`,
          CC_SETTINGS_ENROLLED_REPO: repoPath,
          CC_EXPECTED_REPO: repoPath,
        },
      });
      setupExit = await setup.exited;
    } finally {
      closeSync(fd);
    }

    if (setupExit !== 0) {
      status = "setup-failed";
      await log(`setup.sh failed (exit ${setupExit})`);
      await sendNotification(`cc-settings auto-update: setup failed (exit ${setupExit}) — see log`);
      process.exitCode = 1;
      return;
    }

    status = "updated";
    toVersion = await readInstalledVersion(claudeDir);
    await log(`setup.sh succeeded — installed v${toVersion ?? "unknown"}`);
    await sendNotification(
      `cc-settings v${toVersion ?? "?"} installed — restart Claude Code sessions to apply`,
    );
  } finally {
    if (stagingPath) await rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    await writeState("auto-update-last-run.json", {
      at: isoNow(),
      status,
      fromVersion,
      toVersion,
    });
  }
}

if (import.meta.main) {
  runAutoUpdate()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch(async (err) => {
      await log(`unhandled error: ${(err as Error)?.stack ?? err}`).catch(() => {});
      process.exit(1);
    });
}
