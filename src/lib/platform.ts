// Platform abstraction — port of lib/platform.sh.
//
// Single source of truth for platform detection, timestamp generation, and
// the cross-platform `which` check. No process.platform accesses outside this
// module (downstream code imports `os` from here) so future Windows fixes
// stay local.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

// Returns true if `cmd` is resolvable on PATH. Uses Bun.which which already
// handles Windows `PATHEXT` + `.cmd`/`.exe` suffixes.
export function hasCommand(cmd: string): boolean {
  return Bun.which(cmd) !== null;
}

// Canonical ~/.claude directory. All code should use this rather than
// joining homedir() + ".claude" inline — makes root overridable in tests
// and keeps the derivation in one place.
export const CLAUDE_DIR = join(homedir(), ".claude");

// Join one or more path segments under CLAUDE_DIR.
export function claudePath(...segments: string[]): string {
  return join(CLAUDE_DIR, ...segments);
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
