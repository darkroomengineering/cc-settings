// Package-manager detection and install helpers — port of lib/packages.sh.
//
// Detects the first available system/Node/Python package manager, then
// provides idempotent `ensure` helpers that return true on success.
// Spawns use Bun.spawn for cross-platform argv handling.

import { progressArrow, progressFail, progressOk, progressWarn } from "./colors.ts";
import { hasCommand, os } from "./platform.ts";

export type SystemPM =
  | "brew"
  | "port"
  | "apt"
  | "dnf"
  | "yum"
  | "pacman"
  | "zypper"
  | "apk"
  | "choco"
  | "scoop"
  | "winget"
  | null;

type NodePM = "bun" | "pnpm" | "yarn" | "npm" | null;
type PythonPM = "pipx" | "pip3" | "pip" | null;

export interface PackageManagers {
  system: SystemPM;
  node: NodePM;
  python: PythonPM;
}

let aptUpdated = false;

export function detectSystemPM(): SystemPM {
  const probe = (
    platforms: Array<typeof os>,
    order: Array<{ cmd: string; pm: NonNullable<SystemPM> }>,
  ) => {
    if (!platforms.includes(os)) return null;
    for (const { cmd, pm } of order) if (hasCommand(cmd)) return pm;
    return null;
  };
  return (
    probe(
      ["macos"],
      [
        { cmd: "brew", pm: "brew" },
        { cmd: "port", pm: "port" },
      ],
    ) ??
    probe(
      ["linux", "wsl"],
      [
        { cmd: "apt-get", pm: "apt" },
        { cmd: "dnf", pm: "dnf" },
        { cmd: "yum", pm: "yum" },
        { cmd: "pacman", pm: "pacman" },
        { cmd: "zypper", pm: "zypper" },
        { cmd: "apk", pm: "apk" },
      ],
    ) ??
    probe(
      ["windows"],
      [
        { cmd: "choco", pm: "choco" },
        { cmd: "scoop", pm: "scoop" },
        { cmd: "winget", pm: "winget" },
      ],
    )
  );
}

function detectNodePM(): NodePM {
  if (hasCommand("bun")) return "bun";
  if (hasCommand("pnpm")) return "pnpm";
  if (hasCommand("yarn")) return "yarn";
  if (hasCommand("npm")) return "npm";
  return null;
}

function detectPythonPM(): PythonPM {
  if (hasCommand("pipx")) return "pipx";
  if (hasCommand("pip3")) return "pip3";
  if (hasCommand("pip")) return "pip";
  return null;
}

export function detectPackageManagers(): PackageManagers {
  return { system: detectSystemPM(), node: detectNodePM(), python: detectPythonPM() };
}

// Package installs (apt-get/brew/pip) can legitimately take minutes (cold
// mirror, large dependency tree), so the cap is generous — but still bounded,
// so a stalled installer (e.g. blocked on a sudo password prompt) can't hang
// the setup script forever. stdin is "ignore" (not inherited) precisely to
// prevent that sudo-prompt stall in a non-TTY context: with no stdin to read,
// a prompting sudo fails/exits instead of blocking.
const PACKAGE_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

async function runSilent(cmd: string[]): Promise<boolean> {
  const proc = Bun.spawn(cmd, {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
    timeout: PACKAGE_INSTALL_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  return (await proc.exited) === 0;
}

// --- ensure helpers --------------------------------------------------------

export async function ensureSystemPackage(pkg: string, checkCmd = pkg): Promise<boolean> {
  if (hasCommand(checkCmd)) {
    progressOk(checkCmd);
    return true;
  }
  const pms = detectPackageManagers();
  if (!pms.system) {
    progressWarn(`${pkg} - no package manager available`);
    return false;
  }
  progressArrow(`Installing ${pkg} via ${pms.system}...`);

  const installCmd: Record<NonNullable<SystemPM>, string[]> = {
    brew: ["brew", "install", pkg],
    port: ["sudo", "port", "install", pkg],
    apt: ["sudo", "apt-get", "install", "-y", pkg],
    dnf: ["sudo", "dnf", "install", "-y", pkg],
    yum: ["sudo", "yum", "install", "-y", pkg],
    pacman: ["sudo", "pacman", "-S", "--noconfirm", pkg],
    zypper: ["sudo", "zypper", "install", "-y", pkg],
    apk: ["sudo", "apk", "add", pkg],
    choco: ["choco", "install", pkg, "-y"],
    scoop: ["scoop", "install", pkg],
    winget: ["winget", "install", "--id", pkg, "-e", "--silent"],
  };

  if (pms.system === "apt" && !aptUpdated) {
    await runSilent(["sudo", "apt-get", "update", "-qq"]);
    aptUpdated = true;
  }

  const ok = await runSilent(installCmd[pms.system]);
  if (ok) progressOk(`${pkg} installed`);
  else progressFail(`Failed to install ${pkg}`);
  return ok;
}

export async function ensurePythonPackage(pkg: string, checkCmd = pkg): Promise<boolean> {
  if (hasCommand(checkCmd)) {
    progressOk(checkCmd);
    return true;
  }
  const pms = detectPackageManagers();
  if (!pms.python) {
    progressWarn(`${pkg} - pip/pipx not available`);
    return false;
  }
  progressArrow(`Installing ${pkg} via ${pms.python}...`);
  const installCmd: Record<NonNullable<PythonPM>, string[]> = {
    pipx: ["pipx", "install", pkg],
    pip3: ["pip3", "install", "--user", pkg],
    pip: ["pip", "install", "--user", pkg],
  };
  const ok = await runSilent(installCmd[pms.python]);
  if (ok) progressOk(`${pkg} installed`);
  else progressFail(`Failed to install ${pkg}`);
  return ok;
}

// Manual-copy hint commands (no -y/--noconfirm — the user reviews before
// running), keyed by detected system package manager. Mirrors the argv map
// in ensureSystemPackage's installCmd, minus the auto-confirm flags.
const SYSTEM_HINT_CMD: Record<NonNullable<SystemPM>, (pkg: string) => string> = {
  brew: (pkg) => `brew install ${pkg}`,
  port: (pkg) => `sudo port install ${pkg}`,
  apt: (pkg) => `sudo apt install ${pkg}`,
  dnf: (pkg) => `sudo dnf install ${pkg}`,
  yum: (pkg) => `sudo yum install ${pkg}`,
  pacman: (pkg) => `sudo pacman -S ${pkg}`,
  zypper: (pkg) => `sudo zypper install ${pkg}`,
  apk: (pkg) => `sudo apk add ${pkg}`,
  choco: (pkg) => `choco install ${pkg}`,
  scoop: (pkg) => `scoop install ${pkg}`,
  winget: (pkg) => `winget install --id ${pkg} -e --silent`,
};

/**
 * Pure mapping from a (possibly already-detected) SystemPM to an install
 * hint string, with an OS-based fallback when no system PM was detected
 * (e.g. a minimal container with none of brew/apt/dnf/pacman/… on PATH).
 * Split out from `getInstallHint` so callers/tests can supply an explicit
 * `pm` without depending on real environment probing.
 */
export function getInstallHintForPM(pm: SystemPM, pkg: string): string {
  if (pm) return SYSTEM_HINT_CMD[pm](pkg);
  if (os === "macos") return `brew install ${pkg}`;
  if (os === "linux" || os === "wsl") return `sudo apt install ${pkg}`;
  if (os === "windows") return `choco install ${pkg}`;
  return `Install ${pkg} using your package manager`;
}

/**
 * Install hint for a missing tool, based on the *detected* system package
 * manager (dnf/yum/pacman/zypper/apk on Linux, not just apt) so a Fedora/Arch/
 * Alpine user doesn't get an apt command that fails outright.
 */
export function getInstallHint(pkg: string): string {
  return getInstallHintForPM(detectSystemPM(), pkg);
}
