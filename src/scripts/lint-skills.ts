#!/usr/bin/env bun
// CLI for the skills linter. Exits non-zero on any error; warnings pass.
//
// Usage:
//   bun run lint:skills        # lints skills/ at repo root
//   bun src/scripts/lint-skills.ts <dir>  # lints a custom dir

import { join, resolve } from "node:path";
import { formatFindings, hasErrors, lintSkillsDir } from "../lib/lint-skills.ts";

async function main(): Promise<number> {
  const arg = process.argv[2];
  const skillsDir = arg ? resolve(arg) : join(import.meta.dir, "..", "..", "skills");
  const result = await lintSkillsDir(skillsDir);
  console.log(formatFindings(result));
  return hasErrors(result) ? 1 : 0;
}

process.exit(await main());
