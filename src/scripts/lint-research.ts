#!/usr/bin/env bun
// CLI for the RESEARCH.md shape validator. Exits non-zero on any error; warnings
// pass. RESEARCH.md is the /harvest → /autoresearch seam (see src/lib/lint-research.ts).
//
// Usage:
//   bun run lint:research                          # walk skills/ for every RESEARCH.md
//   bun src/scripts/lint-research.ts <dir>         # walk a custom skills dir
//   bun src/scripts/lint-research.ts <path>/RESEARCH.md   # lint one seed file

import { join, resolve } from "node:path";
import {
  formatFindings,
  hasErrors,
  lintResearchDir,
  lintResearchFiles,
} from "../lib/lint-research.ts";

async function main(): Promise<number> {
  const arg = process.argv[2];
  const result = arg?.endsWith("RESEARCH.md")
    ? await lintResearchFiles([resolve(arg)])
    : await lintResearchDir(arg ? resolve(arg) : join(import.meta.dir, "..", "..", "skills"));
  console.log(formatFindings(result));
  return hasErrors(result) ? 1 : 0;
}

process.exit(await main());
