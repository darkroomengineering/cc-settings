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
  // Enable the ACTIVE_SKILLS↔disk invariant only for the canonical repo run
  // (no custom dir arg); a custom dir isn't necessarily the managed skills/.
  const result = await lintSkillsDir(skillsDir, { checkManaged: !arg });
  console.log(formatFindings(result));
  return hasErrors(result) ? 1 : 0;
}

process.exit(await main());
