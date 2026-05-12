#!/usr/bin/env bun

// CLI for the skills linter. Exits non-zero on any error; warnings pass.
//
// Usage:
//   bun run lint:skills        # lints skills/ at repo root
//   bun src/scripts/lint-skills.ts <dir>  # lints a custom dir

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatFindings, hasErrors, lintSkillsDir } from "../lib/lint-skills.ts";

async function main(): Promise<number> {
  const arg = process.argv[2];
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..", "..");
  const skillsDir = arg ? resolve(arg) : join(repoRoot, "skills");

  const result = await lintSkillsDir(skillsDir);
  console.log(formatFindings(result));

  return hasErrors(result) ? 1 : 0;
}

process.exit(await main());
