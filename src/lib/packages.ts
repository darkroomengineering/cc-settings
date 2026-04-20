// Package-manager detection and install helpers — port of lib/packages.sh.
//
// Detects the first available system/Node/Python package manager, then
// provides idempotent `ensure` helpers that return true on success.
// Spawns use Bun.spawn for cross-platform argv handling.

import { progressArrow, progressFail, progressOk, progressWarn } from "./colors.ts";
import { hasCommand, os } from "./platform.ts";

type SystemPM =
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

function detectSystemPM(): SystemPM {
  const probe = (platform: typeof os, order: Array<{ cmd: string; pm: NonNullable<SystemPM> }>) => {
    if (os !== platform) return null;
    for (const { cmd, pm } of order) if (hasCommand(cmd)) return pm;
    return null;
  };
  return (
    probe("macos", [
      { cmd: "brew", pm: "brew" },
      { cmd: "port", pm: "port" },
    ]) ??
    probe("linux", [
      { cmd: "apt-get", pm: "apt" },
      { cmd: "dnf", pm: "dnf" },
      { cmd: "yum", pm: "yum" },
      { cmd: "pacman", pm: "pacman" },
      { cmd: "zypper", pm: "zypper" },
      { cmd: "apk", pm: "apk" },
    ]) ??
    probe("wsl", [
      { cmd: "apt-get", pm: "apt" },
      { cmd: "dnf", pm: "dnf" },
      { cmd: "yum", pm: "yum" },
      { cmd: "pacman", pm: "pacman" },
      { cmd: "zypper", pm: "zypper" },
      { cmd: "apk", pm: "apk" },
    ]) ??
    probe("windows", [
      { cmd: "choco", pm: "choco" },
      { cmd: "scoop", pm: "scoop" },
      { cmd: "winget", pm: "winget" },
    ])
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

async function runSilent(cmd: string[]): Promise<boolean> {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
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

export async function ensureNpmGlobal(pkg: string, checkCmd = pkg): Promise<boolean> {
  if (hasCommand(checkCmd)) {
    progressOk(checkCmd);
    return true;
  }
  const pms = detectPackageManagers();
  if (!pms.node) {
    progressWarn(`${pkg} - npm/bun not available`);
    return false;
  }
  progressArrow(`Installing ${pkg} via ${pms.node}...`);
  const installCmd: Record<NonNullable<NodePM>, string[]> = {
    bun: ["bun", "add", "--global", pkg],
    pnpm: ["pnpm", "add", "-g", pkg],
    yarn: ["yarn", "global", "add", pkg],
    npm: ["npm", "install", "-g", pkg],
  };
  const ok = await runSilent(installCmd[pms.node]);
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

export function getInstallHint(pkg: string): string {
  if (os === "macos") return `brew install ${pkg}`;
  if (os === "linux" || os === "wsl") return `sudo apt install ${pkg}`;
  if (os === "windows") return `choco install ${pkg}`;
  return `Install ${pkg} using your package manager`;
}
