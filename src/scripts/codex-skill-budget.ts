#!/usr/bin/env bun

import { homedir } from "node:os";
import {
  DEFAULT_CODEX_SKILL_BUDGET_TOKENS,
  formatCodexSkillBudget,
  measureCodexSkillBudget,
} from "../lib/codex-skill-budget.ts";

function usage(): void {
  console.log(`Usage: bun run codex:skill-budget [--budget <tokens>] [--top <n>] [--json]

Measures the skill descriptions Codex loads from $CODEX_HOME/skills,
~/.agents/skills, and every enabled plugin, then compares the total with the
skills context budget. Read-only: it never edits config.toml.

  --budget <tokens>  Budget to compare against (default ${DEFAULT_CODEX_SKILL_BUDGET_TOKENS}, Codex's 2%
                     cap for a 500K-context model; read budget_limit from the
                     Codex log for the exact value)
  --top <n>          How many of the longest descriptions to list (default 10)
  --json             Print the raw report instead of the table
  --help             Show this help`);
}

function readNumber(args: string[], flag: string): number | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} expects a positive number`);
  }
  return value;
}

async function main(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return 0;
  }
  const report = await measureCodexSkillBudget({ budgetTokens: readNumber(args, "--budget") });
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatCodexSkillBudget(report, homedir(), readNumber(args, "--top") ?? 10));
  }
  return report.overBudget ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  },
);
