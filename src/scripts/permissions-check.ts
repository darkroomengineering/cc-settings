#!/usr/bin/env bun
// Dry-run CLI for cc-settings' composed Bash permission rules. Mirrors
// `codex execpolicy check --rules <file> -- <command...>` (openai/codex) —
// classifies a command against the permission rules without invoking Claude
// Code. See src/lib/permissions-check.ts for the matching semantics.
//
// Usage:
//   bun run permissions:check "git status"
//   bun run permissions:check "git push origin main" --json
//   bun run permissions:check --installed "rm -rf /"   # against ~/.claude/settings.json
//   bun run permissions:check --tool Read "some/path"  # non-Bash: prints a note, exits 0

import { join, resolve } from "node:path";
import { composeSettings } from "../lib/compose-settings.ts";
import { readJsonOrNull } from "../lib/json-io.ts";
import {
  classifyCommand,
  extractBashRuleSet,
  formatResult,
  type RuleSet,
} from "../lib/permissions-check.ts";
import { CLAUDE_DIR } from "../lib/platform.ts";

// src/scripts/permissions-check.ts -> repo root is two levels up.
const REPO_ROOT = resolve(import.meta.dir, "..", "..");

interface Args {
  json: boolean;
  installed: boolean;
  tool: string | null;
  command: string;
}

function parseArgs(argv: string[]): Args {
  let json = false;
  let installed = false;
  let tool: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--json") json = true;
    else if (a === "--installed") installed = true;
    else if (a === "--tool") tool = argv[++i] ?? null;
    else if (a.startsWith("--tool=")) tool = a.slice("--tool=".length);
    else rest.push(a);
  }
  return { json, installed, tool, command: rest.join(" ") };
}

/** Source of rules: reuse the composition path behind `bun run compose`
 *  (config/ fragments), falling back to the installed ~/.claude/settings.json
 *  when --installed is passed.
 *
 *  readJsonOrNull only swallows ENOENT (returns null — "no installed
 *  settings.json" is a legitimate, silent-empty-ruleset case). Malformed
 *  JSON (JsonParseError) and other I/O failures (EACCES, EISDIR, …)
 *  propagate to the caller — silently falling back to an empty rule set on
 *  those would make every command look unmatched (decision "ask") instead
 *  of surfacing that the classification is unreliable. */
async function loadRuleSet(useInstalled: boolean): Promise<RuleSet> {
  if (useInstalled) {
    const settingsPath = join(CLAUDE_DIR, "settings.json");
    const parsed = await readJsonOrNull(settingsPath);
    const permissions =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).permissions
        : undefined;
    return extractBashRuleSet(permissions);
  }
  const composed = await composeSettings(REPO_ROOT);
  return extractBashRuleSet(composed.permissions);
}

async function main(): Promise<number> {
  const { json, installed, tool, command } = parseArgs(process.argv.slice(2));

  // Non-Bash tool rules are out of scope v1 (see src/lib/permissions-check.ts).
  if (tool && tool !== "Bash") {
    console.log(
      `Non-Bash tool rules are out of scope in v1 — permissions:check only classifies Bash commands. Requested tool: ${tool}`,
    );
    return 0;
  }

  if (!command) {
    console.error(
      'Usage: bun run permissions:check "<command>" [--json] [--installed] [--tool Bash]',
    );
    return 1;
  }

  let rules: RuleSet;
  try {
    rules = await loadRuleSet(installed);
  } catch (err) {
    const source = installed ? join(CLAUDE_DIR, "settings.json") : "config/ fragments";
    console.error(`Failed to load permission rules from ${source}: ${(err as Error).message}`);
    return 1;
  }
  const result = classifyCommand(command, rules);

  console.log(json ? JSON.stringify(result, null, 2) : formatResult(result));

  // Dry-run: this is a classification tool, not an enforcement gate — it
  // always exits 0 on a successful classification, whatever the decision.
  return 0;
}

process.exit(await main());
