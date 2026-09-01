// Platform abstraction — port of lib/platform.sh.
//
// Single source of truth for platform detection, timestamp generation, and
// the cross-platform `which` check. No process.platform accesses outside this
// module (downstream code imports `os` from here) so future Windows fixes
// stay local.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type OS = "macos" | "linux" | "wsl" | "windows" | "unknown";

function detectOS(): OS {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "linux": {
      if (process.env.WSL_DISTRO_NAME) return "wsl";
      // /proc/version is the canonical signal; treat missing as not-WSL.
      try {
        const v = readFileSync("/proc/version", "utf8");
        if (/microsoft|wsl/i.test(v)) return "wsl";
      } catch {
        // not on linux /proc, or permission denied — assume plain linux
      }
      return "linux";
    }
    case "win32":
      return "windows";
    default:
      return "unknown";
  }
}

export const os: OS = detectOS();

export function isWindows(): boolean {
  return os === "windows";
}

// Raw Node platform/arch triple (e.g. "darwin"/"arm64") — distinct from the
// `OS` enum above (which normalizes "darwin" → "macos" etc). Callers that need
// the literal Node strings (checksum-key lookups, download-URL templating)
// import these instead of reaching for process.platform/process.arch
// directly, preserving the "no process.platform outside this module" invariant.
export const platform: NodeJS.Platform = process.platform;
export const arch: string = process.arch;

/** Platform discriminator for checksum lookup ("darwin-arm64", …) — matches the
 *  keys pinned-binary descriptors store their per-platform checksums under.
 *  Lives here rather than in engine-pin.ts so download-verify.ts can name a
 *  platform without importing a descriptor module that imports it back. */
export function platformKey(): string {
  return `${platform}-${arch}`;
}

// Zero-pad a number to two characters. Shared across timestamp / date / time
// formatters that need stable filename-safe output.
export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// YYYYMMDDHHMMSS — used for backup filenames. Stable across locales.
export function getTimestamp(d: Date = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// YYYY-MM-DD — used for daily log filenames and date grouping. Stable across locales.
export function ymd(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Resolves `cmd` to an absolute path via the LIVE `process.env.PATH`, or null.
// The explicit PATH option matters: without it Bun.which consults the PATH
// captured at process boot, so runtime mutations (tests installing shims under
// a temp dir) are invisible. Bun.which already handles Windows `PATHEXT` +
// `.cmd`/`.exe` suffixes.
export function whichCommand(cmd: string): string | null {
  return Bun.which(cmd, { PATH: process.env.PATH ?? "" });
}

// Returns true if `cmd` is resolvable on PATH.
export function hasCommand(cmd: string): boolean {
  return whichCommand(cmd) !== null;
}

// Canonical ~/.claude directory. Install and inspection code must always use
// this path so a hook-scoped environment override cannot redirect setup.
export const CLAUDE_DIR = join(homedir(), ".claude");

// Hooks shared with Codex need a private state root under PLUGIN_DATA rather
// than writing Claude-specific logs and handoffs into ~/.claude.
const RUNTIME_DIR = process.env.CC_SETTINGS_HOME
  ? resolve(process.env.CC_SETTINGS_HOME)
  : CLAUDE_DIR;

// Join one or more runtime-state path segments under the active product root.
export function claudePath(...segments: string[]): string {
  return join(RUNTIME_DIR, ...segments);
}

/** The install-adjacent paths a status/inspection pass reads. Bundled on
 *  purpose: `gatherStatus` used to take a bare `claudeDir` and then read
 *  ~/.claude.json and the launchd plist from the real $HOME regardless, so a
 *  caller passing a fixture directory got a mix of fixture and host state and
 *  its tests could only assert shape (nuclear-review-2026-07-29 F3). Passing one
 *  value makes partial overriding impossible. */
export interface InstallPaths {
  /** ~/.claude — the install target. */
  claudeDir: string;
  /** ~/.claude.json — a SIBLING of claudeDir, not a child of it, which is why
   *  it cannot be derived from claudeDir alone. */
  claudeJsonPath: string;
  /** $HOME — where the auto-update launchd plist lives. */
  homeDir: string;
}

/** Build an InstallPaths. Defaults to the real host locations; tests and
 *  dry-runs pass a fixture claudeDir and home. */
export function installPaths(
  claudeDir: string = CLAUDE_DIR,
  home: string = homedir(),
): InstallPaths {
  return { claudeDir, claudeJsonPath: join(home, ".claude.json"), homeDir: home };
}

// ISO-8601 timestamp without milliseconds: "2026-06-19T12:34:56Z".
// Replaces the five inline `new Date().toISOString().replace(/\.\d{3}Z$/, "Z")`
// idioms scattered across scripts and hooks.
export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

// YYYY-MM-DD HH:MM:SS in local time — bash parity: `date '+%Y-%m-%d %H:%M:%S'`.
// Replaces the three private formatters (formatTimestamp/formatDate/hms) that
// produced identical output across stop-failure.ts, session-start.ts, log-bash.ts.
export function localDatetime(d: Date = new Date()): string {
  return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
