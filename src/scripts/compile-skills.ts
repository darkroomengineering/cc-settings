#!/usr/bin/env bun
// Compile the skill activation index — port of scripts/compile-skills.sh.
// Scans ~/.claude/skills/*/SKILL.md for frontmatter, combines with the
// in-memory patterns from src/lib/skill-patterns.ts, emits
// ~/.claude/skill-index.compiled (PATTERN|SKILL_NAME|PRIORITY|ENFORCEMENT|AGENTS).
//
// Idempotent: compares a checksum of all SKILL.md contents against
// ~/.claude/skill-index.checksum and skips compilation if unchanged.
// `--force` / `-f` always recompiles.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { info, warn } from "../lib/colors.ts";
import { SKILL_DEFS } from "../lib/skill-patterns.ts";

const CLAUDE_DIR = join(homedir(), ".claude");
const SKILLS_DIR = join(CLAUDE_DIR, "skills");
const COMPILED_INDEX = join(CLAUDE_DIR, "skill-index.compiled");
const COMPILED_CHECKSUM = join(CLAUDE_DIR, "skill-index.checksum");

function listSkillFiles(): string[] {
  if (!existsSync(SKILLS_DIR)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(SKILLS_DIR)) {
    const full = join(SKILLS_DIR, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    const skillMd = join(full, "SKILL.md");
    if (existsSync(skillMd)) out.push(skillMd);
  }
  return out.sort();
}

function computeChecksum(files: string[]): string {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const f of files) {
    try {
      hasher.update(readFileSync(f));
    } catch {
      // skip unreadable
    }
  }
  return hasher.digest("hex");
}

type Frontmatter = {
  name?: string;
  description?: string;
  agent?: string;
};

function parseFrontmatter(text: string): Frontmatter | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  try {
    const body = match[1] ?? "";
    const parsed = parseYaml(body) as Frontmatter;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function compile(): Promise<void> {
  info("Compiling skill index...");
  const files = listSkillFiles();
  const lines: string[] = [
    "# Skill Index - Auto-generated",
    "# Do not edit manually - run compile-skills to regenerate",
    "# Format: PATTERN|SKILL_NAME|PRIORITY|ENFORCEMENT|AGENTS",
    "# Patterns are case-insensitive regex",
    "#",
    `# Generated: ${new Date().toISOString()}`,
    "#",
  ];

  let skillCount = 0;
  let patternCount = 0;

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const fm = parseFrontmatter(text);
    const skillName = fm?.name;
    if (!skillName) {
      warn(`No name found in: ${file}`);
      continue;
    }
    const explicitAgent = fm?.agent;
    const def = SKILL_DEFS[skillName];

    const patterns = new Set<string>([skillName]);
    if (def) for (const p of def.patterns) if (p) patterns.add(p);

    const priority = def?.priority ?? "low";
    const enforcement = def?.enforcement ?? "suggest";
    const agents = explicitAgent ? explicitAgent : (def?.agents ?? []).join(",");

    skillCount++;
    for (const p of patterns) {
      lines.push(`${p}|${skillName}|${priority}|${enforcement}|${agents}`);
      patternCount++;
    }
  }

  await writeFile(COMPILED_INDEX, `${lines.join("\n")}\n`);
  await writeFile(COMPILED_CHECKSUM, computeChecksum(files));

  info(`Compiled ${patternCount} patterns from ${skillCount} skills`);
  info(`Index written to: ${COMPILED_INDEX}`);
}

function needsRecompile(files: string[]): boolean {
  if (!existsSync(COMPILED_INDEX)) return true;
  if (!existsSync(COMPILED_CHECKSUM)) return true;
  const current = computeChecksum(files);
  let stored = "";
  try {
    stored = readFileSync(COMPILED_CHECKSUM, "utf8").trim();
  } catch {
    return true;
  }
  return current !== stored;
}

const args = process.argv.slice(2);
const force = args.includes("--force") || args.includes("-f");

if (!existsSync(SKILLS_DIR)) {
  console.error(`Skills directory not found: ${SKILLS_DIR}`);
  process.exit(1);
}

const files = listSkillFiles();
if (force || needsRecompile(files)) {
  await compile();
} else {
  info("Skill index is up to date (use --force to recompile)");
}
