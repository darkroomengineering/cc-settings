#!/usr/bin/env bun
// CLI for the profile frontmatter linter. Exits non-zero on any error;
// warnings pass.
//
// Usage:
//   bun run lint:profiles        # lints profiles/ at repo root
//   bun src/scripts/lint-profiles.ts <dir>  # lints a custom dir

import { join, resolve } from "node:path";
import { formatProfileFindings, hasProfileErrors, lintProfilesDir } from "../lib/lint-profiles.ts";

async function main(): Promise<number> {
  const arg = process.argv[2];
  const profilesDir = arg ? resolve(arg) : join(import.meta.dir, "..", "..", "profiles");
  const result = await lintProfilesDir(profilesDir);
  console.log(formatProfileFindings(result));
  return hasProfileErrors(result) ? 1 : 0;
}

process.exit(await main());
