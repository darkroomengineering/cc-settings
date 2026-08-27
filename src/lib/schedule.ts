// Daily auto-update scheduling — macOS launchd mechanics + the enrollment
// decision logic. Registers/unregisters a launchd job that pulls cc-settings
// and re-runs the installer nightly. See SECURITY.md for the threat-model
// note (the launchd job is a persistence surface outside the four defense
// layers) and plans/swift-wiggling-lobster.md for the full design.

import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
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
  /** Launcher binary prepended to ProgramArguments. System Settings > Login
   *  Items groups a launchd job under the code-signer of the binary it
   *  executes — running bun directly files the job under bun's upstream
   *  signer ("Jarred Sumner"), not Darkroom. Exec-ing through a
   *  Darkroom-signed passthrough wrapper reattributes it. */
  wrapperPath?: string;
  /** Emitted as AssociatedBundleIdentifiers so the job nests under that
   *  app's row in Login Items. macOS honors it only when the executed
   *  binary's team ID matches the app's, so this only works together with
   *  wrapperPath. */
  associatedBundleId?: string;
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
  wrapperPath,
  associatedBundleId,
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
  const assocBlock =
    associatedBundleId !== undefined
      ? `\t<key>AssociatedBundleIdentifiers</key>
\t<array>
\t\t<string>${xmlEscape(associatedBundleId)}</string>
\t</array>
`
      : "";
  const programArgs = [...(wrapperPath !== undefined ? [wrapperPath] : []), bunPath, scriptPath]
    .map((p) => `\t\t<string>${xmlEscape(p)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${assocBlock}	<key>Label</key>
	<string>${xmlEscape(AUTO_UPDATE_LABEL)}</string>
	<key>ProgramArguments</key>
	<array>
${programArgs}
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

export interface AutoUpdateStateSnapshot {
  plist: { present: false } | { present: true; bytes: Uint8Array; mode: number };
  loaded: boolean;
  repoPath: string | null;
  restoreMode: "managed-restorable" | "independent-preserve-only";
}

interface SerializedAutoUpdateState {
  version: 3;
  state: null | {
    loaded: boolean;
    repo_path: string | null;
    restore_mode: "managed-restorable" | "independent-preserve-only";
    plist: { present: false } | { present: true; bytes_base64: string; mode: number };
  };
}

export function serializeAutoUpdateState(snapshot: AutoUpdateStateSnapshot | null): string {
  const payload: SerializedAutoUpdateState = {
    version: 3,
    state: snapshot
      ? {
          loaded: snapshot.loaded,
          repo_path: snapshot.repoPath,
          restore_mode: snapshot.restoreMode,
          plist: snapshot.plist.present
            ? {
                present: true,
                bytes_base64: Buffer.from(snapshot.plist.bytes).toString("base64"),
                mode: snapshot.plist.mode,
              }
            : { present: false },
        }
      : null,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function parseAutoUpdateState(serialized: string): AutoUpdateStateSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (cause) {
    throw new Error("Invalid Claude backup auto-update metadata JSON", { cause });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid Claude backup auto-update metadata");
  }
  const payload = parsed as Record<string, unknown>;
  if (payload.version !== 2 && payload.version !== 3) {
    throw new Error("Unsupported Claude backup auto-update metadata");
  }
  if (payload.state === null) return null;
  if (!payload.state || typeof payload.state !== "object" || Array.isArray(payload.state)) {
    throw new Error("Invalid Claude backup auto-update state");
  }
  const state = payload.state as Record<string, unknown>;
  if (typeof state.loaded !== "boolean") throw new Error("Invalid auto-update loaded state");
  if (state.repo_path !== null && typeof state.repo_path !== "string") {
    throw new Error("Invalid auto-update repository path");
  }
  const restoreMode =
    payload.version === 2
      ? "managed-restorable"
      : state.restore_mode === "managed-restorable" ||
          state.restore_mode === "independent-preserve-only"
        ? state.restore_mode
        : null;
  if (!restoreMode) throw new Error("Invalid auto-update restore mode");
  if (!state.plist || typeof state.plist !== "object" || Array.isArray(state.plist)) {
    throw new Error("Invalid auto-update plist metadata");
  }
  const plist = state.plist as Record<string, unknown>;
  if (plist.present === false) {
    if (state.loaded) throw new Error("Loaded auto-update snapshot is missing its plist");
    return {
      loaded: false,
      plist: { present: false },
      repoPath: state.repo_path as string | null,
      restoreMode,
    };
  }
  if (
    plist.present !== true ||
    typeof plist.bytes_base64 !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(plist.bytes_base64) ||
    typeof plist.mode !== "number" ||
    !Number.isInteger(plist.mode) ||
    plist.mode < 0 ||
    plist.mode > 0o777
  ) {
    throw new Error("Invalid auto-update plist snapshot");
  }
  const bytes = Buffer.from(plist.bytes_base64, "base64");
  if (bytes.toString("base64") !== plist.bytes_base64) {
    throw new Error("Invalid auto-update plist base64 payload");
  }
  return {
    loaded: state.loaded,
    plist: { present: true, bytes, mode: plist.mode },
    repoPath: state.repo_path as string | null,
    restoreMode,
  };
}

async function readScheduledOwnership(
  claudeDir: string,
): Promise<{ repoPath: string | null; managed: boolean }> {
  const sentinel = await readFile(join(claudeDir, ".cc-settings-version"), "utf8").catch(
    () => null,
  );
  if (sentinel === null) return { repoPath: null, managed: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(sentinel);
  } catch {
    return { repoPath: null, managed: false };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { repoPath: null, managed: false };
  }
  const sentinelState = parsed as Record<string, unknown>;
  const repoPath = sentinelState.repo_path;
  return {
    repoPath: typeof repoPath === "string" && isAbsolute(repoPath) ? resolve(repoPath) : null,
    managed:
      sentinelState.auto_update === true && sentinelState.managed_files_state !== "managed-absent",
  };
}

/** Validate that persisted scheduler bytes can only recreate cc-settings' canonical job. */
export async function validateAutoUpdateStateSnapshot(
  snapshot: AutoUpdateStateSnapshot | null,
  homeDir: string = homedir(),
  claudeDir: string = join(homeDir, ".claude"),
): Promise<void> {
  if (!snapshot?.plist.present) return;
  if (snapshot.restoreMode === "independent-preserve-only") return;
  if (!snapshot.repoPath || !isAbsolute(snapshot.repoPath) || snapshot.plist.mode !== 0o600) {
    throw new Error("Unsafe auto-update snapshot ownership metadata");
  }
  const repoMetadata = await lstat(snapshot.repoPath).catch(() => null);
  if (!repoMetadata?.isDirectory() || repoMetadata.isSymbolicLink()) {
    throw new Error("Unsafe auto-update snapshot repository path");
  }
  const common = {
    bunPath: process.execPath,
    scriptPath: join(claudeDir, "src", "scripts", "auto-update.ts"),
    logPath: autoUpdateLogPath(claudeDir),
    repoPath: snapshot.repoPath,
  };
  const wrapperPath = join(homeDir, ".hammerspoon", "helpers", "darkroom-run");
  const candidates = [
    buildPlist(common),
    buildPlist({
      ...common,
      wrapperPath,
      associatedBundleId: "com.darkroom.helpers",
    }),
  ];
  const bytes = Buffer.from(snapshot.plist.bytes).toString("utf8");
  if (!candidates.includes(bytes)) {
    throw new Error("Auto-update snapshot plist is not the canonical cc-settings LaunchAgent");
  }
}

/** Capture the one cc-settings LaunchAgent before a transactional lifecycle.
 * A loaded job with no plist cannot be reconstructed exactly, so fail before
 * either product mutates instead of claiming compensation is possible. */
export async function snapshotAutoUpdateState(
  homeDir: string = homedir(),
  claudeDir: string = join(homeDir, ".claude"),
): Promise<AutoUpdateStateSnapshot | null> {
  if (os !== "macos") return null;
  const path = plistPath(homeDir);
  const metadata = await lstat(path).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return null;
    throw cause;
  });
  if (metadata?.isSymbolicLink() || (metadata && !metadata.isFile())) {
    throw new Error(`Unsafe auto-update plist boundary: ${path}`);
  }
  const loaded = await strictAutoUpdateJobLoaded(homeDir);
  if (loaded && !metadata) {
    throw new Error(`Cannot snapshot loaded ${AUTO_UPDATE_LABEL}: its plist is missing at ${path}`);
  }
  const ownership = await readScheduledOwnership(claudeDir);
  const snapshot: AutoUpdateStateSnapshot = {
    plist: metadata
      ? { present: true, bytes: await readFile(path), mode: metadata.mode & 0o777 }
      : { present: false },
    loaded,
    repoPath: ownership.repoPath,
    restoreMode:
      ownership.managed || (!metadata && !loaded)
        ? "managed-restorable"
        : "independent-preserve-only",
  };
  await validateAutoUpdateStateSnapshot(snapshot, homeDir, claudeDir);
  return snapshot;
}

/** Restore only the cc-settings LaunchAgent's exact file and load state. */
export async function restoreAutoUpdateState(
  snapshot: AutoUpdateStateSnapshot | null,
  homeDir: string = homedir(),
): Promise<void> {
  if (!snapshot || os !== "macos") return;
  await validateAutoUpdateStateSnapshot(snapshot, homeDir, join(homeDir, ".claude"));
  if (snapshot.restoreMode === "independent-preserve-only") {
    const current = await snapshotAutoUpdateState(homeDir, join(homeDir, ".claude"));
    const exactMatch =
      current !== null &&
      current.loaded === snapshot.loaded &&
      current.plist.present === snapshot.plist.present &&
      (!current.plist.present ||
        (snapshot.plist.present &&
          current.plist.mode === snapshot.plist.mode &&
          Buffer.from(current.plist.bytes).equals(Buffer.from(snapshot.plist.bytes))));
    if (!exactMatch) {
      throw new Error(
        "Independent preserve-only auto-update state changed; restore its exact plist and load state before retrying.",
      );
    }
    return;
  }
  const path = plistPath(homeDir);
  const current = await lstat(path).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return null;
    throw cause;
  });
  if (current?.isSymbolicLink() || (current && !current.isFile())) {
    throw new Error(`Unsafe auto-update plist boundary during restore: ${path}`);
  }

  if (!shouldSkipLaunchctl()) {
    const uid = process.getuid?.() ?? 0;
    const result = await runProcessFull("launchctl", [
      "bootout",
      `gui/${uid}/${AUTO_UPDATE_LABEL}`,
    ]);
    if (result.exit !== 0 && !isAbsentBootoutResult(result, uid)) {
      throw new Error(
        `Could not prepare ${AUTO_UPDATE_LABEL} restore: ${result.stderr.trim() || `launchctl bootout exited ${result.exit}`}`,
      );
    }
  }

  if (snapshot.plist.present) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, snapshot.plist.bytes);
    await chmod(path, snapshot.plist.mode);
  } else {
    await rm(path, { force: true });
  }

  if (snapshot.loaded && !shouldSkipLaunchctl()) {
    const uid = process.getuid?.() ?? 0;
    const result = await runProcessFull("launchctl", ["bootstrap", `gui/${uid}`, path]);
    if (result.exit !== 0) {
      throw new Error(
        `Could not restore ${AUTO_UPDATE_LABEL}: ${result.stderr.trim() || `launchctl bootstrap exited ${result.exit}`}`,
      );
    }
  }
  if (!shouldSkipLaunchctl() && (await strictAutoUpdateJobLoaded(homeDir)) !== snapshot.loaded) {
    throw new Error(`Could not restore ${AUTO_UPDATE_LABEL} load state exactly`);
  }
}

async function strictAutoUpdateJobLoaded(homeDir: string = homedir()): Promise<boolean> {
  if (shouldSkipLaunchctl()) return existsSync(plistPath(homeDir));
  const uid = process.getuid?.() ?? 0;
  const result = await runProcessFull("launchctl", ["print", `gui/${uid}/${AUTO_UPDATE_LABEL}`]);
  if (result.exit === 0) return true;
  const detail = `${result.stdout}\n${result.stderr}`.trim();
  if (isExactAbsentLaunchctlResult(result, uid)) return false;
  throw new Error(
    `Could not query ${AUTO_UPDATE_LABEL} load state: ${detail || `launchctl print exited ${result.exit}`}`,
  );
}

export function isExactAbsentLaunchctlResult(
  result: { exit: number; stdout: string; stderr: string },
  uid: number,
): boolean {
  const detail = `${result.stdout}\n${result.stderr}`.trim();
  const notFoundLine = `Could not find service "${AUTO_UPDATE_LABEL}" in domain for user gui:\\s*${uid}\\.?`;
  const notFound = new RegExp(`^(?:Bad request\\.\\r?\\n)?${notFoundLine}$`);
  return result.exit === 113 && notFound.test(detail);
}

/**
 * Whether a `launchctl bootout` failure means "the service was not loaded".
 *
 * `bootout` does not report absence the way `print` does: on current macOS it
 * exits 3 (ESRCH) with `Boot-out failed: 3: No such process` instead of the
 * 113 / `Could not find service ...` form. Both spellings are absence and must
 * not abort an install; anything else (permission denied, a busy domain) still
 * fails loudly. Kept as exact matches so a novel error can never be swallowed.
 */
export function isAbsentBootoutResult(
  result: { exit: number; stdout: string; stderr: string },
  uid: number,
): boolean {
  if (isExactAbsentLaunchctlResult(result, uid)) return true;
  const detail = `${result.stdout}\n${result.stderr}`.trim();
  return result.exit === 3 && /^Boot-out failed: 3: No such process\.?$/.test(detail);
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
 * currently-installed script + bun binary, then bootout + bootstrap. No-op on
 * non-macOS. The caller decides whether a returned failure aborts its
 * transaction.
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
    // Login Items grouping: on machines with the Darkroom Helpers app and its
    // signed passthrough launcher, exec bun through the launcher and associate
    // the job with the app so it files under "Darkroom Helpers" instead of
    // bun's upstream signer ("Jarred Sumner"). Both must exist — the
    // association is ignored by macOS without a matching team ID.
    // Threat model: path existence is enough. An attacker able to plant a
    // fake wrapper at these user-owned paths can already write
    // ~/Library/LaunchAgents directly, so trusting them adds no persistence
    // surface beyond what SECURITY.md already covers for this job.
    const wrapperPath = join(homeDir, ".hammerspoon", "helpers", "darkroom-run");
    const helpersApp = join(homeDir, "Applications", "Darkroom Helpers.app");
    const useWrapper = existsSync(wrapperPath) && existsSync(helpersApp);
    await Bun.write(
      plist,
      buildPlist({
        bunPath,
        scriptPath,
        logPath,
        repoPath,
        wrapperPath: useWrapper ? wrapperPath : undefined,
        associatedBundleId: useWrapper ? "com.darkroom.helpers" : undefined,
      }),
    );
    // Bun.write doesn't set mode — restrict to the owner (0o600) so a
    // co-tenant on a shared machine can't read/tamper with the plist.
    await chmod(plist, 0o600);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  if (shouldSkipLaunchctl()) return { ok: true, reason: "skipped-launchctl" };

  try {
    const uid = process.getuid?.() ?? 0;
    const bootout = await runProcessFull("launchctl", [
      "bootout",
      `gui/${uid}/${AUTO_UPDATE_LABEL}`,
    ]);
    if (bootout.exit !== 0 && !isAbsentBootoutResult(bootout, uid)) {
      return {
        ok: false,
        reason: bootout.stderr.trim() || `launchctl bootout exited ${bootout.exit}`,
      };
    }
    const result = await runProcessFull("launchctl", ["bootstrap", `gui/${uid}`, plist]);
    if (result.exit !== 0) {
      return {
        ok: false,
        reason: result.stderr.trim() || `launchctl bootstrap exited ${result.exit}`,
      };
    }
    if (!(await strictAutoUpdateJobLoaded(homeDir))) {
      return { ok: false, reason: `${AUTO_UPDATE_LABEL} was not loaded after bootstrap` };
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
      const result = await runProcessFull("launchctl", [
        "bootout",
        `gui/${uid}/${AUTO_UPDATE_LABEL}`,
      ]);
      if (result.exit !== 0 && !isAbsentBootoutResult(result, uid)) {
        return { ok: false, removed: false };
      }
      if (await strictAutoUpdateJobLoaded(homeDir)) {
        return { ok: false, removed: false };
      }
    } catch {
      return { ok: false, removed: false };
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
