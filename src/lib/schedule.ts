// Daily auto-update scheduling — macOS launchd mechanics + the enrollment
// decision logic. Registers/unregisters a launchd job that pulls cc-settings
// and re-runs the installer nightly. See SECURITY.md for the threat-model
// note (the launchd job is a persistence surface outside the four defense
// layers) and plans/swift-wiggling-lobster.md for the full design.

import { existsSync } from "node:fs";
import { chmod, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { runProcessFull } from "./git.ts";
import { claudePath, hasCommand, os } from "./platform.ts";

export const AUTO_UPDATE_LABEL = "com.darkroom.cc-settings-autoupdate";

/** The only cc-settings origin the nightly job is allowed to pull from.
 *  Unauthenticated sentinel fields (repo_path) can point anywhere on disk —
 *  this constant is the manifest-covered anchor that keeps a forged
 *  repo_path from turning into arbitrary nightly code execution. See
 *  isAllowedPullSource() and SECURITY.md. */
export const EXPECTED_ORIGIN = "github.com/darkroomengineering/cc-settings";

/**
 * True only when `url` normalizes to exactly `https://<EXPECTED_ORIGIN>` —
 * the darkroomengineering/cc-settings repo over HTTPS. Strips a trailing
 * `.git` and trailing slashes before comparing. Anything else (a local
 * path, a different host/owner/repo, the bare remote name "origin", an
 * empty string) is rejected. Pure — no disk/network access.
 */
export function isAllowedPullSource(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  // Strip trailing slash(es) BEFORE the .git suffix — otherwise a URL like
  // "…/cc-settings.git/" never matches /\.git$/ because the slash is in the
  // way, leaving a false negative for a perfectly valid origin form.
  const normalized = trimmed.replace(/\/+$/, "").replace(/\.git$/, "");
  return normalized === `https://${EXPECTED_ORIGIN}`;
}

/** Absolute path to the launchd plist for the auto-update job. `homeDir` is
 *  injectable for tests — mutating process.env.HOME in-process does NOT
 *  redirect homedir() on macOS, so a test relying on the env var would
 *  clobber the developer's real ~/Library/LaunchAgents plist. */
export function plistPath(homeDir: string = homedir()): string {
  return join(homeDir, "Library", "LaunchAgents", `${AUTO_UPDATE_LABEL}.plist`);
}

/** Log file the plist's StandardOut/ErrPath point at, and that
 *  src/scripts/auto-update.ts appends every step to. Derived from the
 *  claudeDir in play (not the frozen CLAUDE_DIR constant) so sandboxed
 *  callers stay inside their sandbox. */
export function autoUpdateLogPath(claudeDir?: string): string {
  return claudeDir
    ? join(claudeDir, "logs", "auto-update.log")
    : claudePath("logs", "auto-update.log");
}

/** Escape XML special characters for embedding in a plist string value.
 *  Order matters — `&` must be escaped first or the entity refs below get
 *  double-escaped. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface BuildPlistArgs {
  bunPath: string;
  scriptPath: string;
  logPath: string;
  /** Repo path pinned at registration time, embedded as the
   *  CC_EXPECTED_REPO environment variable so the nightly job can verify
   *  the sentinel's repo_path hasn't been swapped out from under it —
   *  a second surface an attacker must also compromise (see auto-update.ts
   *  and SECURITY.md). Omitted (no EnvironmentVariables dict) when absent —
   *  legacy plists without this pin still work, just skip that gate. */
  repoPath?: string;
  hour?: number;
  minute?: number;
}

/** Pure plist XML builder — no disk access, snapshot-testable. All
 *  user-provided path strings are xmlEscape'd before embedding. */
export function buildPlist({
  bunPath,
  scriptPath,
  logPath,
  repoPath,
  hour = 10,
  minute = 0,
}: BuildPlistArgs): string {
  const envBlock =
    repoPath !== undefined
      ? `\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>CC_EXPECTED_REPO</key>
\t\t<string>${xmlEscape(repoPath)}</string>
\t</dict>
`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${xmlEscape(AUTO_UPDATE_LABEL)}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${xmlEscape(bunPath)}</string>
		<string>${xmlEscape(scriptPath)}</string>
	</array>
${envBlock}	<key>StartCalendarInterval</key>
	<dict>
		<key>Hour</key>
		<integer>${hour}</integer>
		<key>Minute</key>
		<integer>${minute}</integer>
	</dict>
	<key>StandardOutPath</key>
	<string>${xmlEscape(logPath)}</string>
	<key>StandardErrorPath</key>
	<string>${xmlEscape(logPath)}</string>
</dict>
</plist>
`;
}

export type AutoUpdateDecision =
  | { kind: "set"; enrolled: boolean }
  | { kind: "keep"; enrolled: boolean | undefined }
  | { kind: "ask" };

export interface DecideAutoUpdateArgs {
  /** --auto-update=on|off flag value, or null if not passed. */
  flag: "on" | "off" | null;
  /** Prior enrollment decision read from the sentinel, or undefined if never decided. */
  sentinelValue: boolean | undefined;
  /** Whether stdin is a real TTY (isInteractive() from prompts.ts). */
  isTTY: boolean;
  /** Whether the launchd job actually exists right now (autoUpdateJobLoaded()).
   *  Corroborates sentinelValue===true against real OS state — an
   *  unauthenticated sentinel claiming "enrolled" with no matching job is
   *  either forged or desynced, and must never silently register a new job. */
  jobPresent: boolean;
}

/**
 * Pure resolution of the auto-update enrollment decision. Security-critical:
 * a non-interactive run with no explicit flag and no prior decision MUST
 * leave enrollment untouched (kind:"keep", enrolled:undefined) — silent
 * enrollment from an unattended run (CI, the nightly job re-running
 * setup.sh with stdin:"ignore") is never acceptable. Equally critical: a
 * sentinel claiming `auto_update:true` with NO matching launchd job (forged,
 * or desynced by hand-editing the sentinel) must never be trusted on its
 * own to (re)register — it's corroborated against real OS state via
 * `jobPresent`.
 *
 *   flag "on"/"off"                        → set true/false (explicit, works non-interactively)
 *   sentinel===false                       → keep false (never re-ask)
 *   sentinel===true && jobPresent           → keep true (legit: refresh an existing job)
 *   sentinel===true && !jobPresent          → forged/desynced: TTY ? ask : keep undefined
 *   sentinel===undefined                    → TTY ? ask : keep undefined
 */
export function decideAutoUpdate({
  flag,
  sentinelValue,
  isTTY,
  jobPresent,
}: DecideAutoUpdateArgs): AutoUpdateDecision {
  if (flag === "on") return { kind: "set", enrolled: true };
  if (flag === "off") return { kind: "set", enrolled: false };
  if (sentinelValue === false) return { kind: "keep", enrolled: false };
  if (sentinelValue === true) {
    if (jobPresent) return { kind: "keep", enrolled: true };
    return isTTY ? { kind: "ask" } : { kind: "keep", enrolled: undefined };
  }
  // sentinelValue === undefined — never decided.
  if (isTTY) return { kind: "ask" };
  return { kind: "keep", enrolled: undefined };
}

/** True when launchctl calls should be skipped (tests/CI/no launchctl on PATH). */
function shouldSkipLaunchctl(): boolean {
  return (
    process.env.CC_SKIP_SCHEDULE === "1" || process.env.CI === "true" || !hasCommand("launchctl")
  );
}

/**
 * Whether the auto-update launchd job is actually loaded right now — real OS
 * state, used by decideAutoUpdate to corroborate a sentinel claiming
 * `auto_update:true`. When launchctl is unavailable (tests/CI/no launchctl
 * on PATH), falls back to plist-file presence. Fail-soft: any throw → false
 * (never trust a failed check as "present").
 */
export async function autoUpdateJobLoaded(homeDir: string = homedir()): Promise<boolean> {
  try {
    if (shouldSkipLaunchctl()) return existsSync(plistPath(homeDir));
    const uid = process.getuid?.() ?? 0;
    const result = await runProcessFull("launchctl", ["print", `gui/${uid}/${AUTO_UPDATE_LABEL}`]);
    return result.exit === 0;
  } catch {
    return false;
  }
}

/**
 * (Re)register the auto-update launchd job: write the plist pointed at the
 * currently-installed script + bun binary, then bootout (ignore failure —
 * "not loaded" is the expected first-run case) + bootstrap. No-op on
 * non-macOS. Fail-soft throughout — a registration failure never aborts the
 * install.
 *
 * `repoPath` (when provided) is embedded in the plist as CC_EXPECTED_REPO —
 * the source repo path known at registration time, pinned as a second
 * verification surface alongside the origin allowlist (see auto-update.ts).
 */
export async function registerAutoUpdate(
  claudeDir: string,
  homeDir: string = homedir(),
  repoPath?: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (os !== "macos") return { ok: true, reason: "non-macos" };

  const plist = plistPath(homeDir);
  try {
    await mkdir(dirname(plist), { recursive: true });
    const bunPath = process.execPath;
    const scriptPath = join(claudeDir, "src", "scripts", "auto-update.ts");
    const logPath = autoUpdateLogPath(claudeDir);
    await mkdir(dirname(logPath), { recursive: true });
    await Bun.write(plist, buildPlist({ bunPath, scriptPath, logPath, repoPath }));
    // Bun.write doesn't set mode — restrict to the owner (0o600) so a
    // co-tenant on a shared machine can't read/tamper with the plist.
    await chmod(plist, 0o600);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  if (shouldSkipLaunchctl()) return { ok: true, reason: "skipped-launchctl" };

  try {
    const uid = process.getuid?.() ?? 0;
    try {
      await runProcessFull("launchctl", ["bootout", `gui/${uid}/${AUTO_UPDATE_LABEL}`]);
    } catch {
      // ignored — "not loaded" is the expected first-registration case
    }
    const result = await runProcessFull("launchctl", ["bootstrap", `gui/${uid}`, plist]);
    if (result.exit !== 0) {
      return {
        ok: false,
        reason: result.stderr.trim() || `launchctl bootstrap exited ${result.exit}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/**
 * Unregister the auto-update launchd job: bootout (ignore failure) + remove
 * the plist file if present. No-op on non-macOS.
 */
export async function unregisterAutoUpdate(
  homeDir: string = homedir(),
): Promise<{ ok: boolean; removed: boolean }> {
  if (os !== "macos") return { ok: true, removed: false };

  if (!shouldSkipLaunchctl()) {
    try {
      const uid = process.getuid?.() ?? 0;
      await runProcessFull("launchctl", ["bootout", `gui/${uid}/${AUTO_UPDATE_LABEL}`]);
    } catch {
      // ignored — "not loaded" is expected
    }
  }

  const plist = plistPath(homeDir);
  if (!existsSync(plist)) return { ok: true, removed: false };
  try {
    await rm(plist, { force: true });
    return { ok: true, removed: true };
  } catch {
    return { ok: false, removed: false };
  }
}

/** Side-effect-free status check for `--status` — no launchctl call. */
export async function autoUpdateStatus(
  homeDir: string = homedir(),
): Promise<{ plistPresent: boolean }> {
  return { plistPresent: existsSync(plistPath(homeDir)) };
}
