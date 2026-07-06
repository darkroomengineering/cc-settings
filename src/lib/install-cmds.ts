// Install command helpers — extracted from src/setup.ts (§1.1).
//
// One-shot commands that run before the main install logic:
//   printHelp — usage text
//   cmdRollback — restore a backup archive

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { error, info, success } from "./colors.ts";
import { CLAUDE_DIR } from "./platform.ts";

export function printHelp(version: string): void {
  console.log(`cc-settings installer v${version}

Usage: bun src/setup.ts [flags]

Flags:
  --source=<dir>     Source repo path (default: parent of setup.ts).
  --rollback[=TS]    Restore newest backup, or one matching timestamp TS.
  --dry-run          Print planned actions; do not touch disk.
  --light            Install raw Claude Code + statusLine + share-learning only:
                       • skills: share-learning (only)
                       • settings.json: $schema + statusLine only
                       • no MCP servers, no hooks, no effort override
                       • no CLAUDE.md, AGENTS.md, agents, rules, profiles,
                         docs, or permission rules
                     Re-run without --light to upgrade to full.
  --status           Report installed version, drift vs repo HEAD, missing
                     managed skills, hooks, key env vars, and MCP servers.
  --interactive      Prompt on settings.json conflicts (scalar overrides, team
                     additions to allow/ask rules, new hook groups). Also opt in
                     via CC_INTERACTIVE=1.
  --migrate-only     Run only the settings.json merger + version sentinel;
                     skip file copy, dependency install, and skill/agent
                     refresh. Use after a cc-settings update if you only
                     want the merger's deprecation prune to apply.
  --help, -h         Show this message.

Rollback examples:
  bun src/setup.ts --rollback
  bun src/setup.ts --rollback=2026-04-20T10-00-00Z`);
}

/** True when a `tar -tzf` listing entry is unsafe to extract: an absolute
 *  path, or a path containing a ".." segment (path traversal). Pure/exported
 *  for testing without spawning tar. */
export function isUnsafeTarEntry(entry: string): boolean {
  if (entry.startsWith("/")) return true;
  return entry.split("/").some((segment) => segment === "..");
}

export async function cmdRollback(target: string | true): Promise<number> {
  const backupDir = `${CLAUDE_DIR}/backups`;
  if (!existsSync(backupDir)) {
    error(`No backups directory found at ${backupDir}`);
    return 1;
  }
  const entries = (await readdir(backupDir))
    .filter((e) => /^backup-.*\.tar\.gz$/.test(e))
    .sort()
    .reverse();
  const match = target === true ? entries[0] : entries.find((e) => e.includes(target));
  if (!match) {
    error("No matching backup found.");
    console.error("Available backups:");
    for (const e of entries.slice(0, 5)) console.error(`  ${e}`);
    return 1;
  }
  info(`Rolling back from: ${match}`);
  const archivePath = `${backupDir}/${match}`;
  // Newer archives are $HOME-relative (entries prefixed with ".claude/", plus a
  // top-level ".claude.json"); pre-MCP-backup archives are ~/.claude-relative
  // (bare "settings.json"). Detect the layout so each restores to the right place.
  const listing = Bun.spawn(["tar", "-tzf", archivePath], { stdout: "pipe", stderr: "ignore" });
  const archiveEntries = (await new Response(listing.stdout).text()).trim().split("\n");
  await listing.exited;
  const homeRelative = archiveEntries.some((e) => e.startsWith(".claude/") || e === ".claude.json");
  // Path-traversal guard: reject the archive outright if any listed entry
  // would extract outside the destination directory (absolute path, or a
  // ".." segment escaping it). The listing was already fetched above for
  // layout detection, so this costs no extra tar invocation.
  const unsafeEntry = archiveEntries.find(isUnsafeTarEntry);
  if (unsafeEntry) {
    error(`Refusing to restore: archive contains an unsafe path entry: ${unsafeEntry}`);
    return 1;
  }
  const proc = Bun.spawn(["tar", "-xzf", archivePath], {
    cwd: homeRelative ? homedir() : CLAUDE_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code === 0) success("Restored. Restart Claude Code to apply.");
  return code;
}
