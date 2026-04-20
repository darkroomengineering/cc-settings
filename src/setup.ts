#!/usr/bin/env bun
// Phase 5 stub. The authoritative installer is still setup.sh during the
// migration window (Phases 4–6). This file reserves the entrypoint so
// downstream docs / scripts can reference it, and adds a minimal
// --rollback that mirrors setup.sh --rollback behavior when invoked from
// the TS path.
//
// Full port lands in a dedicated Phase 5 PR once setup.sh has shipped with
// TS-source installation (already landed). Until then, running
//   bun src/setup.ts
// delegates to `bash setup.sh`.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CLAUDE_DIR = join(homedir(), ".claude");

async function cmdRollback(targetMatch: string): Promise<number> {
  const backupDir = join(CLAUDE_DIR, "backups");
  if (!existsSync(backupDir)) {
    console.error(`ERROR: No backups directory found at ${backupDir}`);
    return 1;
  }
  const entries = (await readdir(backupDir)).filter((e) => /^backup-.*\.tar\.gz$/.test(e));
  const sorted = entries.sort().reverse();
  const match = targetMatch ? sorted.find((e) => e.includes(targetMatch)) : sorted[0];
  if (!match) {
    console.error("ERROR: No matching backup found.");
    console.error("Available backups:");
    for (const e of sorted.slice(0, 5)) console.error(`  ${e}`);
    return 1;
  }
  console.log(`Rolling back from: ${match}`);
  const proc = Bun.spawn(["tar", "-xzf", join(backupDir, match)], {
    cwd: CLAUDE_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code === 0) console.log("Restored. Restart Claude Code to apply.");
  return code;
}

async function cmdDryRun(): Promise<void> {
  console.log("cc-settings installer (dry-run)");
  console.log(`source repo: ${ROOT}`);
  console.log(`target:      ${CLAUDE_DIR}`);
  console.log("");
  console.log("Would install (phase-4-era, summary):");
  const stamp = async (rel: string, desc: string) => {
    const p = join(ROOT, rel);
    console.log(`  ${existsSync(p) ? "✓" : " "} ${rel.padEnd(20)} ${desc}`);
  };
  await stamp("AGENTS.md", "portable coding standards");
  await stamp("CLAUDE-FULL.md", "Claude Code global config");
  await stamp("settings.json", "permissions + hooks + MCP");
  await stamp("scripts/", "bash scripts (authoritative until Phase 7)");
  await stamp("src/scripts/", "TS ports (side-by-side with bash)");
  await stamp("src/hooks/", "TS hook ports");
  await stamp("src/lib/", "shared libs");
  await stamp("src/schemas/", "zod schemas");
  await stamp("agents/", "agent definitions");
  await stamp("skills/", "skill files");
  await stamp("rules/", "path-conditioned rules");
  await stamp("profiles/", "workflow profiles");
  await stamp("contexts/", "ecosystem contexts");
  console.log("");
  console.log("Re-run without --dry-run to perform the install (delegates to setup.sh).");
}

async function delegate(): Promise<number> {
  const proc = Bun.spawn(["bash", join(ROOT, "setup.sh")], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return await proc.exited;
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: bun src/setup.ts [--rollback[=TIMESTAMP]|--dry-run]");
  console.log("");
  console.log("Without flags: delegates to bash setup.sh (Phase 4 migration state).");
  console.log("Phase 5 will replace setup.sh with a full TS port.");
  process.exit(0);
}

for (const a of args) {
  if (a === "--rollback") process.exit(await cmdRollback(""));
  if (a.startsWith("--rollback=")) process.exit(await cmdRollback(a.slice("--rollback=".length)));
  if (a === "--dry-run") {
    await cmdDryRun();
    process.exit(0);
  }
}

// No recognized flags → delegate to bash setup.sh.
process.exit(await delegate());

// Reserved for future use (Phase 5 full port).
void readFile;
