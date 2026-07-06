// CLI preflight check — soft-warn if recommended tools are missing from PATH.
//
// Called from setup.ts after dependency install, before the final summary.
// Never blocks install. Also exposed as a standalone script via
// src/scripts/check-cli-tools.ts.

import { palette, warn } from "./colors.ts";
import { detectSystemPM, type SystemPM } from "./packages.ts";
import { type OS, os } from "./platform.ts";

export type CliTool = {
  name: string;
  purpose: string;
  install: {
    brew?: string;
    apt?: string;
    dnf?: string;
    yum?: string;
    pacman?: string;
    zypper?: string;
    apk?: string;
    winget?: string;
  };
};

export const RECOMMENDED_TOOLS: CliTool[] = [
  {
    name: "rg",
    purpose: "faster code search (Claude falls back to grep without it)",
    install: {
      brew: "brew install ripgrep",
      apt: "apt install ripgrep",
      dnf: "dnf install ripgrep",
      yum: "yum install ripgrep",
      pacman: "pacman -S ripgrep",
      zypper: "zypper install ripgrep",
      apk: "apk add ripgrep",
      winget: "winget install BurntSushi.ripgrep.MSVC",
    },
  },
  {
    name: "fd",
    purpose: "faster file discovery (Claude falls back to find without it)",
    install: {
      brew: "brew install fd",
      // Debian/Ubuntu and Fedora ship the binary as `fd-find` (name clash
      // with an existing package); Arch/Alpine/openSUSE use the plain `fd`.
      apt: "apt install fd-find",
      dnf: "dnf install fd-find",
      yum: "yum install fd-find",
      pacman: "pacman -S fd",
      zypper: "zypper install fd",
      apk: "apk add fd",
      winget: "winget install sharkdp.fd",
    },
  },
  {
    name: "jq",
    purpose: "JSON parsing in shell snippets",
    install: {
      brew: "brew install jq",
      apt: "apt install jq",
      dnf: "dnf install jq",
      yum: "yum install jq",
      pacman: "pacman -S jq",
      zypper: "zypper install jq",
      apk: "apk add jq",
      winget: "winget install jqlang.jq",
    },
  },
  {
    name: "gh",
    purpose: "GitHub CLI — used by ultrareview skill and some agents",
    install: {
      brew: "brew install gh",
      apt: "apt install gh",
      dnf: "dnf install gh",
      yum: "yum install gh",
      // Arch/Alpine package the GitHub CLI under a different name than the binary.
      pacman: "pacman -S github-cli",
      zypper: "zypper install gh",
      apk: "apk add github-cli",
      winget: "winget install GitHub.cli",
    },
  },
];

export function checkCliTools(): { missing: CliTool[]; found: string[] } {
  const missing: CliTool[] = [];
  const found: string[] = [];
  for (const tool of RECOMMENDED_TOOLS) {
    if (Bun.which(tool.name) !== null) {
      found.push(tool.name);
    } else {
      missing.push(tool);
    }
  }
  return { missing, found };
}

/**
 * Pure mapping from a tool's per-manager install commands to the right hint
 * for a given platform + detected system package manager. Split out from
 * `installHint` so tests can supply explicit `pm`/`platform` without
 * depending on real environment probing (PATH, process.platform).
 *
 * On Linux/WSL this consults the *detected* SystemPM (dnf/yum/pacman/zypper/
 * apk, not just apt) so a Fedora/Arch/Alpine user isn't handed an apt command
 * that fails outright. Falls back to the tool's apt hint when the detected
 * PM has no explicit entry (or none was detected), then to the general
 * brew/apt/winget fallback chain.
 */
export function installHintForPM(tool: CliTool, pm: SystemPM, platform: OS = os): string {
  if (platform === "macos" && tool.install.brew) return tool.install.brew;
  if (platform === "windows" && tool.install.winget) return tool.install.winget;
  if (platform === "linux" || platform === "wsl") {
    const byPm: Partial<Record<NonNullable<SystemPM>, string>> = {
      apt: tool.install.apt,
      dnf: tool.install.dnf,
      yum: tool.install.yum,
      pacman: tool.install.pacman,
      zypper: tool.install.zypper,
      apk: tool.install.apk,
    };
    const hint = pm ? byPm[pm] : undefined;
    if (hint) return hint;
    // Undetected/unmapped PM on Linux: apt is still the most common default.
    if (tool.install.apt) return tool.install.apt;
  }
  // Fallback: prefer brew, then apt, then winget
  return tool.install.brew ?? tool.install.apt ?? tool.install.winget ?? "see project docs";
}

function installHint(tool: CliTool): string {
  return installHintForPM(tool, detectSystemPM());
}

export function printPreflightReport(result: ReturnType<typeof checkCliTools>): void {
  const { missing } = result;
  if (missing.length === 0) return;

  console.log("");
  console.log(`${palette.dim}Recommended CLI tools not found on PATH:${palette.reset}`);
  for (const tool of missing) {
    const hint = installHint(tool);
    warn(`${tool.name}  ${palette.dim}${tool.purpose}${palette.reset}`);
    console.log(`  ${palette.dim}→ ${hint}${palette.reset}`);
  }
}
