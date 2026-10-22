#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { codexInstallPaths } from "../lib/codex-install.ts";
import {
  formatLegacyCodexSkillOverlap,
  type LegacyCodexSkillMigration,
  migrateLegacyCodexSkills,
} from "../lib/managed-skills.ts";
import { isPlainObject } from "../lib/merge-keyed.ts";

const DESKTOP_IMPORT_SYNC_KEY = "external-agent-import-sync-enabled";

function usage(): void {
  console.log(`Usage: bun run migrate:codex-skills [--apply]

Moves user-scope ~/.agents/skills directories that duplicate the
darkroom@cc-settings plugin into a timestamped backup. The default is a dry run.

  --apply  Perform the moves unless Codex Desktop import sync is enabled
  --help   Show this help`);
}

async function desktopImportSyncEnabled(): Promise<{ enabled: boolean; configPath: string }> {
  const configPath = codexInstallPaths().configPath;
  let source: string;
  try {
    source = await readFile(configPath, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { enabled: false, configPath };
    throw new Error(`Cannot read Codex config ${configPath}`, { cause });
  }

  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(source);
  } catch (cause) {
    throw new Error(`Cannot parse Codex TOML config ${configPath}`, { cause });
  }
  const desktop = isPlainObject(parsed) ? parsed.desktop : undefined;
  const value = isPlainObject(desktop) ? desktop[DESKTOP_IMPORT_SYNC_KEY] : undefined;
  if (value === undefined) return { enabled: false, configPath };
  if (typeof value !== "boolean") {
    throw new Error(
      `Invalid Codex config ${configPath}: desktop.${DESKTOP_IMPORT_SYNC_KEY} must be a boolean`,
    );
  }
  return { enabled: value, configPath };
}

function printMigration(result: LegacyCodexSkillMigration, applied: boolean): void {
  console.log("");
  console.log(`${applied ? "Moved" : "Would move"}:`);
  for (const name of result.scan.movableNames) console.log(`  ${name}`);
  if (result.scan.blockedNames.length > 0) {
    console.log("Unsafe entries that require manual review:");
    for (const name of result.scan.blockedNames) console.log(`  ${name}`);
  }
  console.log(`Backup: ${result.backupDir}`);
}

async function main(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return 0;
  }
  const unknown = args.filter((arg) => arg !== "--apply");
  if (unknown.length > 0) {
    console.error(`Unknown option: ${unknown.join(", ")}`);
    usage();
    return 1;
  }

  const apply = args.includes("--apply");
  const preview = await migrateLegacyCodexSkills();
  const warning = formatLegacyCodexSkillOverlap(preview.scan);
  if (!warning) {
    console.log("No legacy ~/.agents/skills entries overlap darkroom@cc-settings.");
    return 0;
  }
  console.log(warning);

  const sync = await desktopImportSyncEnabled();
  if (sync.enabled) {
    printMigration(preview, false);
    console.error(
      `Codex Desktop import sync is enabled in ${sync.configPath} ` +
        `(${DESKTOP_IMPORT_SYNC_KEY} = true). Codex Desktop will recreate moved skill directories.`,
    );
    console.error(
      `Set desktop.${DESKTOP_IMPORT_SYNC_KEY} = false, restart Codex completely, then rerun. ` +
        "cc-settings never edits config.toml.",
    );
    if (apply) {
      console.error("Refusing --apply. Preview only; no files changed and no backup was created.");
      return 1;
    }
    console.log("No files changed. Disable sync and restart Codex before applying this migration.");
    return 0;
  }

  const result = apply ? await migrateLegacyCodexSkills({ apply: true }) : preview;
  printMigration(result, apply);
  if (!apply) console.log("No files changed. Re-run with --apply after reviewing this list.");
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  });
}
