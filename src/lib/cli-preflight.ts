// CLI preflight check — soft-warn if recommended tools are missing from PATH.
//
// Called from setup.ts after dependency install, before the final summary.
// Never blocks install. Also exposed as a standalone script via
// src/scripts/check-cli-tools.ts.

import { palette, warn } from "./colors.ts";
import { os } from "./platform.ts";

export type CliTool = {
  name: string;
  purpose: string;
  install: { brew?: string; apt?: string; winget?: string };
};

export const RECOMMENDED_TOOLS: CliTool[] = [
  {
    name: "rg",
    purpose: "faster code search (Claude falls back to grep without it)",
    install: {
      brew: "brew install ripgrep",
      apt: "apt install ripgrep",
      winget: "winget install BurntSushi.ripgrep.MSVC",
    },
  },
  {
    name: "fd",
    purpose: "faster file discovery (Claude falls back to find without it)",
    install: {
      brew: "brew install fd",
      apt: "apt install fd-find",
      winget: "winget install sharkdp.fd",
    },
  },
  {
    name: "jq",
    purpose: "JSON parsing in shell snippets",
    install: {
      brew: "brew install jq",
      apt: "apt install jq",
      winget: "winget install jqlang.jq",
    },
  },
  {
    name: "gh",
    purpose: "GitHub CLI — used by ultrareview skill and some agents",
    install: {
      brew: "brew install gh",
      apt: "apt install gh",
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

function installHint(tool: CliTool): string {
  if (os === "macos" && tool.install.brew) return tool.install.brew;
  if ((os === "linux" || os === "wsl") && tool.install.apt) return tool.install.apt;
  if (os === "windows" && tool.install.winget) return tool.install.winget;
  // Fallback: prefer brew, then apt, then winget
  return tool.install.brew ?? tool.install.apt ?? tool.install.winget ?? "see project docs";
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
