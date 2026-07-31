#!/usr/bin/env bun
// project-init.ts — cross-tool AI config bootstrap.
// Port of scripts/project-init.sh. Copies ~/.claude/AGENTS.md into a target
// project and creates pointer files for Copilot / Cursor / Windsurf so every
// AI coding tool in the team reads the same standards.

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { info, success, warn } from "../lib/colors.ts";
import { claudePath, isoNow } from "../lib/platform.ts";

const SOURCE_AGENTS = claudePath("AGENTS.md");
const VERSION_FILE = claudePath(".cc-settings-version");

function installedVersion(): string {
  if (!existsSync(VERSION_FILE)) return "unknown";
  try {
    const parsed = JSON.parse(readFileSync(VERSION_FILE, "utf8")) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function projectAgentsVersion(file: string): string {
  if (!existsSync(file)) return "";
  try {
    const header = readFileSync(file, "utf8").split(/\r?\n/)[0] ?? "";
    const m = header.match(/cc-settings v([0-9.]+)/);
    return m ? (m[1] ?? "") : "";
  } catch {
    return "";
  }
}

function isManaged(file: string): boolean {
  if (!existsSync(file)) return false;
  try {
    const header = readFileSync(file, "utf8").split(/\r?\n/)[0] ?? "";
    return header.includes("cc-settings");
  } catch {
    return false;
  }
}

function stampAgents(): string {
  const version = installedVersion();
  const ts = isoNow();
  const body = readFileSync(SOURCE_AGENTS, "utf8");
  return `<!-- cc-settings v${version} | ${ts} | DO NOT EDIT — managed by cc-settings -->\n${body}`;
}

const CURSOR_WINDSURF_BODY = `<!-- cc-settings — DO NOT EDIT — managed by cc-settings -->
Read and follow AGENTS.md in the repository root for all coding standards and guardrails.
AGENTS.md is the single source of truth for this project.
`;

const COPILOT_BODY = `<!-- cc-settings — DO NOT EDIT — managed by cc-settings -->
<!-- GitHub Copilot: read AGENTS.md in the repository root for full coding standards -->

Follow the coding standards and guardrails defined in \`AGENTS.md\` at the repository root.
That file is the single source of truth for all AI-assisted development on this project.
`;

async function createPointerFile(dir: string, relPath: string, body: string): Promise<void> {
  const file = join(dir, relPath);
  if (existsSync(file) && !isManaged(file)) {
    info(`Skipping ${relPath} (custom file exists)`);
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body);
  success(relPath);
}

function cmdCheck(dir: string): void {
  const agents = join(dir, "AGENTS.md");
  const installed = installedVersion();
  const projVer = projectAgentsVersion(agents);

  console.log("");
  info(`Project: ${basename(dir)}`);
  console.log("");

  // Managed/unmanaged is decided by isManaged() (same test used everywhere
  // else in this file) — NOT by whether projectAgentsVersion() found a
  // digits-only version. A dev checkout without ~/.claude/.cc-settings-version
  // stamps "cc-settings vunknown" (installedVersion() falls back to the
  // literal "unknown"), which projectAgentsVersion()'s digits-only regex
  // can't parse — that must read as "managed, version unknown", not "not
  // managed by cc-settings".
  if (!existsSync(agents)) {
    warn("AGENTS.md not found — run: project-init.ts");
  } else if (!isManaged(agents)) {
    info("AGENTS.md exists (not managed by cc-settings)");
  } else if (!projVer) {
    info(`AGENTS.md is managed by cc-settings (version unknown — installed: v${installed})`);
  } else if (projVer === installed) {
    success(`AGENTS.md is up to date (v${installed})`);
  } else {
    warn(`AGENTS.md is v${projVer}, installed is v${installed} — run: project-init.ts --update`);
  }

  for (const rel of [".github/copilot-instructions.md", ".cursorrules", ".windsurfrules"]) {
    const full = join(dir, rel);
    if (!existsSync(full)) {
      console.log(`  - ${rel} (not set up)`);
    } else if (isManaged(full)) {
      success(`${rel} (managed)`);
    } else {
      info(`${rel} (custom)`);
    }
  }
  console.log("");
}

async function cmdUpdate(dir: string): Promise<number> {
  const agents = join(dir, "AGENTS.md");
  if (!existsSync(SOURCE_AGENTS)) {
    warn("cc-settings not installed — run setup.sh first");
    return 1;
  }
  if (existsSync(agents) && !isManaged(agents)) {
    warn("AGENTS.md exists but is not managed by cc-settings — skipping");
    warn("Delete it first if you want cc-settings to manage it");
  } else {
    await writeFile(agents, stampAgents());
    success(`AGENTS.md (v${installedVersion()})`);
  }
  await createPointerFile(dir, ".github/copilot-instructions.md", COPILOT_BODY);
  await createPointerFile(dir, ".cursorrules", CURSOR_WINDSURF_BODY);
  await createPointerFile(dir, ".windsurfrules", CURSOR_WINDSURF_BODY);
  return 0;
}

async function cmdInit(dir: string): Promise<number> {
  const agents = join(dir, "AGENTS.md");
  console.log("");
  info(`Setting up cross-tool AI config in: ${basename(dir)}`);
  console.log("");
  if (!existsSync(SOURCE_AGENTS)) {
    warn("cc-settings not installed — run setup.sh first");
    return 1;
  }
  if (existsSync(agents) && !isManaged(agents)) {
    info("AGENTS.md already exists (not managed by cc-settings) — keeping yours");
  } else {
    await writeFile(agents, stampAgents());
    success(`AGENTS.md (v${installedVersion()})`);
  }
  await createPointerFile(dir, ".github/copilot-instructions.md", COPILOT_BODY);
  await createPointerFile(dir, ".cursorrules", CURSOR_WINDSURF_BODY);
  await createPointerFile(dir, ".windsurfrules", CURSOR_WINDSURF_BODY);
  console.log("");
  success("Cross-tool AI config ready. Commit these files to share with your team.");
  console.log("");
  return 0;
}

const args = process.argv.slice(2);
const flag = args.find((a) => a.startsWith("-")) ?? "";
const pathArg = args.find((a) => !a.startsWith("-")) ?? ".";
const dir = resolve(pathArg);

switch (flag) {
  case "--check":
    cmdCheck(dir);
    break;
  case "--update":
    process.exit(await cmdUpdate(dir));
    break;
  case "--help":
  case "-h":
    console.log("Usage: project-init.ts [directory|--check|--update]");
    break;
  default:
    process.exit(await cmdInit(dir));
}
