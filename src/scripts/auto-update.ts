#!/usr/bin/env bun
// Nightly auto-update job — run by the launchd job registered by
// registerAutoUpdate() (src/lib/schedule.ts). Clones official main into
// isolated staging and re-runs the installer from there non-interactively.
// The enrolled checkout is read for its origin only and never modified.
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
import { appendFile, lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
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

function isAutoUpdateTest(): boolean {
  return process.env.NODE_ENV === "test" && process.env.CC_SETTINGS_TEST_MODE === "auto-update";
}

function shellPath(path: string): string {
  return isAutoUpdateTest() ? path.replaceAll("\\", "/") : path;
}

function testCommand(envName: string): string[] | null {
  const encoded = process.env[envName];
  if (!encoded || !isAutoUpdateTest()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error(`Invalid ${envName}`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((part) => typeof part !== "string" || !isAbsolute(part))
  ) {
    throw new Error(`${envName} must contain absolute command paths`);
  }
  return parsed as string[];
}

function gitCommand(): string[] {
  return testCommand("CC_SETTINGS_TEST_GIT_COMMAND_JSON") ?? ["git"];
}

function setupCommand(): string[] {
  return testCommand("CC_SETTINGS_TEST_SETUP_COMMAND_JSON") ?? ["/bin/bash", "setup.sh"];
}

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
  if (isAutoUpdateTest()) {
    if (env.HOME) env.HOME = shellPath(env.HOME);
    if (env.USERPROFILE) env.USERPROFILE = shellPath(env.USERPROFILE);
  }

  const proc = Bun.spawn([...gitCommand(), ...SAFE_GIT_CONFIG, ...args], {
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

/** Names of the copies setup saves when it replaces a hand-edited CLAUDE.md
 *  or AGENTS.md. Setup's own warning goes to the log, so the run compares
 *  these before and after to tell the user through a notification. */
async function userEditBackups(claudeDir: string): Promise<Set<string>> {
  const names = await readdir(join(claudeDir, "backups")).catch(() => [] as string[]);
  return new Set(names.filter((name) => name.includes(".user-edit-")));
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
    // attacker-controlled clone is rejected here — only the real
    // darkroomengineering/cc-settings repo over HTTPS is ever pulled from.
    if (pullSource === null || !isAllowedPullSource(pullSource)) {
      status = "blocked-origin";
      await log(`blocked — origin '${originUrl}' is not the expected cc-settings repo`);
      await sendNotification(
        "auto-update blocked — cc-settings origin is not the expected repo (see ~/.claude/logs/auto-update.log)",
      );
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

    // The install decision reads only the installed version and official main.
    // The enrolled checkout is a developer's working copy: untracked files,
    // feature branches, and local commits are normal there and say nothing
    // about whether ~/.claude is current, so its state never gates the run.
    // computeDrift installs only when official main is newer, so an install
    // from a local branch at or above main's version is never downgraded.
    const packaged = await readPackagedVersion(stagingPath);
    const { stale } = computeDrift(fromVersion, packaged);

    if (!stale) {
      status = "up-to-date";
      await log(`already up to date with official main ${official.stdout}`);
      return;
    }

    await log(
      `installed v${fromVersion ?? "unknown"} is behind official main v${packaged ?? "unknown"} (${official.stdout}) — running setup.sh from isolated clone`,
    );
    const logPath = autoUpdateLogPath();
    await mkdir(dirname(logPath), { recursive: true }).catch(() => {});

    // launchd provides a minimal PATH. System dirs come FIRST and the
    // user-writable ~/.bun/bin comes LAST — a planted binary earlier in a
    // user-writable dir must never shadow the real bash/git/bun. bash is
    // invoked by absolute path for the same reason (no PATH lookup at all).
    const editsBefore = await userEditBackups(claudeDir);
    const fd = openSync(logPath, "a");
    let setupExit: number;
    try {
      const setup = Bun.spawn(setupCommand(), {
        cwd: stagingPath,
        stdin: "ignore",
        stdout: fd,
        stderr: fd,
        timeout: 300_000,
        killSignal: "SIGKILL",
        env: {
          ...process.env,
          HOME: shellPath(process.env.HOME ?? homedir()),
          USERPROFILE: shellPath(process.env.USERPROFILE ?? homedir()),
          PATH: `/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:${shellPath(homedir())}/.bun/bin`,
          CC_SETTINGS_ENROLLED_REPO: shellPath(repoPath),
          CC_EXPECTED_REPO: shellPath(repoPath),
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
    const replaced = [...(await userEditBackups(claudeDir))]
      .filter((name) => !editsBefore.has(name))
      .map((name) => name.split(".user-edit-")[0]);
    if (replaced.length > 0) {
      await log(
        `replaced hand-edited ${replaced.join(", ")}; copies saved in ~/.claude/backups. Keep personal instructions in ~/.claude/personal.md, which setup never replaces.`,
      );
    }
    await sendNotification(
      replaced.length > 0
        ? `cc-settings v${toVersion ?? "?"} installed — replaced your edited ${replaced.join(", ")}; a copy is in ~/.claude/backups, keep yours in ~/.claude/personal.md`
        : `cc-settings v${toVersion ?? "?"} installed — restart Claude Code sessions to apply`,
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
