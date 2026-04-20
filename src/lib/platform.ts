// Platform abstraction — port of lib/platform.sh.
//
// Single source of truth for platform detection, timestamp generation, and
// the cross-platform `which` check. No process.platform accesses outside this
// module (downstream code imports `os` from here) so future Windows fixes
// stay local.

import { readFileSync } from "node:fs";

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

export function isMacOS(): boolean {
  return os === "macos";
}

export function isLinux(): boolean {
  return os === "linux" || os === "wsl";
}

export function isWindows(): boolean {
  return os === "windows";
}

// YYYYMMDDHHMMSS — used for backup filenames. Stable across locales.
export function getTimestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Returns true if `cmd` is resolvable on PATH. Uses Bun.which which already
// handles Windows `PATHEXT` + `.cmd`/`.exe` suffixes.
export function hasCommand(cmd: string): boolean {
  return Bun.which(cmd) !== null;
}
