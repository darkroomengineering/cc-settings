#!/usr/bin/env bun
// CLI for the `SHORTCUT:` marker validator. Exits non-zero when a marker names no
// upgrade trigger; warnings pass. The convention lives in AGENTS.md (Laziness
// Ladder) and the ledger view backs `/audit debt` (see src/lib/lint-shortcuts.ts).
//
// Usage:
//   bun run lint:shortcuts              # validate markers under the repo root
//   bun run lint:shortcuts -- --ledger  # print the /audit debt ledger
//   bun run lint:shortcuts -- --json    # machine-readable markers + findings
//   bun src/scripts/lint-shortcuts.ts <dir>

import { resolve } from "node:path";
import {
  formatFindings,
  formatLedger,
  hasErrors,
  lintShortcutsDir,
} from "../lib/lint-shortcuts.ts";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const ledger = args.includes("--ledger");
  const dirArg = args.find((a) => !a.startsWith("--"));
  const root = dirArg ? resolve(dirArg) : resolve(import.meta.dir, "..", "..");

  const result = await lintShortcutsDir(root);

  if (json) {
    console.log(JSON.stringify({ markers: result.markers, findings: result.findings }, null, 2));
  } else if (ledger) {
    console.log(formatLedger(result));
  } else {
    console.log(formatFindings(result));
  }

  return hasErrors(result) ? 1 : 0;
}

process.exit(await main());
