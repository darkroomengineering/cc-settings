#!/usr/bin/env bun
// CLI for the markdown link validator. Exits non-zero on a missing file target
// or an anchor that resolves to no heading. External URLs are never fetched.
// See src/lib/lint-links.ts.
//
// Usage:
//   bun run lint:links               # validate every .md under the repo root
//   bun src/scripts/lint-links.ts <dir>

import { resolve } from "node:path";
import { formatFindings, hasErrors, lintLinksDir } from "../lib/lint-links.ts";

async function main(): Promise<number> {
  const arg = process.argv[2];
  const root = arg ? resolve(arg) : resolve(import.meta.dir, "..", "..");
  const result = await lintLinksDir(root);
  console.log(formatFindings(result));
  console.log(`Checked ${result.linkCount} intra-repo link(s).`);
  return hasErrors(result) ? 1 : 0;
}

process.exit(await main());
