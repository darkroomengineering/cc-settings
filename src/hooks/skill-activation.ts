#!/usr/bin/env bun
// UserPromptSubmit hook — classify prompt and suggest skills + agents.
// Port of scripts/skill-activation.sh.
//
// AUDIT NOTE (Phase 4.10): Claude Code now has a native Skill tool that
// matches skills automatically. This hook remains for now because it also
// suggests *agents* (a mapping the native tool doesn't do) and classifies
// by priority/enforcement. The hook is a candidate for deletion once the
// native Skill tool's SubagentStart hook can replace it. Track in
// ~/.claude/skill-activation-audit-decision.md (TODO if kept long-term).
//
// Uses src/lib/skill-patterns.ts — O(1) Record lookup, replaces the bash
// case/grep chain that ran on every prompt.

import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { hasCommand } from "../lib/platform.ts";
import { KNOWN_SKILLS, SKILL_DEFS, type SkillDef } from "../lib/skill-patterns.ts";

const OUTPUT_FILE = join(homedir(), ".claude", "skill-activation.out");

const prompt = process.argv[2] ?? "";
if (!prompt) process.exit(0);

const promptLower = prompt.toLowerCase();

function matchesSkill(def: SkillDef): boolean {
  for (const pattern of def.patterns) {
    try {
      if (new RegExp(pattern, "i").test(promptLower)) return true;
    } catch {
      // invalid regex — fall back to substring match
      if (promptLower.includes(pattern.toLowerCase())) return true;
    }
  }
  return false;
}

const critical: string[] = [];
const recommended: string[] = [];
const suggested: string[] = [];
const agents = new Set<string>();

for (const name of KNOWN_SKILLS) {
  if (name === "tldr" && !hasCommand("tldr")) continue;
  const def = SKILL_DEFS[name];
  if (!def) continue;
  if (!matchesSkill(def)) continue;

  if (def.enforcement === "block" || def.priority === "critical") {
    critical.push(name);
  } else if (def.priority === "high") {
    recommended.push(name);
  } else {
    suggested.push(name);
  }
  for (const a of def.agents) if (a) agents.add(a);
}

// Ambiguous matches (special-cased in bash).
const ambiguous: string[] = [];
if (/\btest\b/.test(promptLower) && !/(run|write|add).*tests?/.test(promptLower)) {
  ambiguous.push("test [skill] - validate if testing is requested");
}
if (/\bplan\b/.test(promptLower) && !/(create|make|write).*plan/.test(promptLower)) {
  ambiguous.push("plan [keyword] - validate if planning is requested");
}

if (critical.length === 0 && recommended.length === 0 && suggested.length === 0) {
  process.exit(0);
}

const lines: string[] = [""];
lines.push("SKILL ACTIVATION CHECK");
lines.push("------------------------------------");
lines.push("");
if (critical.length > 0) {
  lines.push("CRITICAL SKILLS (REQUIRED):");
  lines.push(`   -> ${critical.join(", ")}`);
  lines.push("");
}
if (recommended.length > 0) {
  lines.push("RECOMMENDED SKILLS:");
  lines.push(`   -> ${recommended.join(", ")}`);
  lines.push("");
}
if (suggested.length > 0) {
  lines.push("SUGGESTED SKILLS:");
  lines.push(`   -> ${suggested.join(", ")}`);
  lines.push("");
}
if (agents.size > 0) {
  lines.push("RECOMMENDED AGENTS:");
  lines.push(`   -> ${[...agents].sort().join(", ")}`);
  lines.push("");
}
if (ambiguous.length > 0) {
  lines.push("AMBIGUOUS MATCHES (validate before activating):");
  lines.push(`   ${ambiguous.join(", ")}`);
  lines.push("");
}
lines.push("------------------------------------");

const out = `${lines.join("\n")}\n`;
await writeFile(OUTPUT_FILE, out).catch(() => {});
process.stdout.write(out);
