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
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { runGit, runProcessFull } from "../lib/git.ts";
import { writeState } from "../lib/hook-runtime.ts";
import { CLAUDE_DIR, isoNow } from "../lib/platform.ts";
import { autoUpdateLogPath, isAllowedPullSource } from "../lib/schedule.ts";
import { readInstalledVersion, readSentinelInfo } from "../lib/version-delta.ts";
import { sendNotification } from "./notify.ts";

type RunStatus =
  | "up-to-date"
  | "updated"
  | "skipped-dirty"
  | "pull-failed"
  | "setup-failed"
  | "no-repo"
  | "blocked-origin"
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

export async function runAutoUpdate(claudeDir: string = CLAUDE_DIR): Promise<void> {
  let fromVersion: string | null = null;
  let toVersion: string | null = null;
  let status: RunStatus = "no-repo";

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

    const dirty = await runGit(["status", "--porcelain"], { cwd: repoPath });
    if (dirty.trim() !== "") {
      status = "skipped-dirty";
      await log("skipped — uncommitted changes in cc-settings");
      await sendNotification("auto-update skipped — uncommitted changes in cc-settings");
      return;
    }

    const originUrl = await runGit(["remote", "get-url", "origin"], { cwd: repoPath });
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

    const before = await runGit(["rev-parse", "HEAD"], { cwd: repoPath });

    // core.hooksPath=/dev/null disables git hooks for this pull. Even a clean
    // --ff-only merge from the allowlisted origin runs a post-merge hook if
    // one exists in repoPath/.git/hooks — an attacker who planted a hook in a
    // legit clone could otherwise get code execution without ever forging a
    // bad origin. Defence-in-depth on top of the origin allowlist + path pin.
    const pull = await runProcessFull("git", [
      "-c",
      "core.hooksPath=/dev/null",
      "-C",
      repoPath,
      "pull",
      "--ff-only",
      pullSource,
      "main",
    ]);
    if (pull.exit !== 0) {
      status = "pull-failed";
      await log(`git pull failed (exit ${pull.exit}): ${pull.stderr.trim()}`);
      await sendNotification(
        "auto-update failed — git pull error (see ~/.claude/logs/auto-update.log)",
      );
      process.exitCode = 1;
      return;
    }

    const after = await runGit(["rev-parse", "HEAD"], { cwd: repoPath });
    if (before === after) {
      status = "up-to-date";
      await log("already up to date");
      return;
    }

    await log(`pulled ${before} -> ${after}, running setup.sh`);
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
        cwd: repoPath,
        stdin: "ignore",
        stdout: fd,
        stderr: fd,
        timeout: 300_000,
        killSignal: "SIGKILL",
        env: {
          ...process.env,
          PATH: `/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:${homedir()}/.bun/bin`,
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
