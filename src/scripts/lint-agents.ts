#!/usr/bin/env bun
// CLI for the agent frontmatter linter. Exits non-zero on any error;
// warnings pass.
//
// Usage:
//   bun run lint:agents        # lints agents/ at repo root
//   bun src/scripts/lint-agents.ts <dir>  # lints a custom dir

import { join, resolve } from "node:path";
import { formatAgentFindings, hasAgentErrors, lintAgentsDir } from "../lib/lint-agents.ts";

async function main(): Promise<number> {
  const arg = process.argv[2];
  const agentsDir = arg ? resolve(arg) : join(import.meta.dir, "..", "..", "agents");
  const result = await lintAgentsDir(agentsDir);
  console.log(formatAgentFindings(result));
  return hasAgentErrors(result) ? 1 : 0;
}

process.exit(await main());
