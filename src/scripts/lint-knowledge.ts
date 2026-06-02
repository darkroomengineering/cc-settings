#!/usr/bin/env bun
// CLI for the knowledge-note linter. Exits non-zero on any error; warnings pass.
//
// Usage:
//   bun run lint:knowledge                   # needs KNOWLEDGE_REPO_PATH set
//   bun run lint:knowledge <dir>             # lints a specific directory
//   KNOWLEDGE_REPO_PATH=/path bun run lint:knowledge

import { resolve } from "node:path";
import {
  formatKnowledgeFindings,
  hasKnowledgeErrors,
  lintKnowledgeDir,
} from "../lib/lint-knowledge.ts";

async function main(): Promise<number> {
  const arg = process.argv[2];
  const envPath = process.env.KNOWLEDGE_REPO_PATH;

  if (!arg && !envPath) {
    console.log("No knowledge directory specified.");
    console.log("Set KNOWLEDGE_REPO_PATH or pass a dir:");
    console.log("  bun run lint:knowledge <dir>");
    console.log("  KNOWLEDGE_REPO_PATH=/path/to/repo bun run lint:knowledge");
    return 0;
  }

  const knowledgeDir = arg ? resolve(arg) : resolve(envPath as string);
  const result = await lintKnowledgeDir(knowledgeDir);
  console.log(formatKnowledgeFindings(result));
  return hasKnowledgeErrors(result) ? 1 : 0;
}

process.exit(await main());
