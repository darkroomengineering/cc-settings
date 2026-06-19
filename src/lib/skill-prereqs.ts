// Skill prerequisite checker. Runs at install: walks skills/, parses each
// SKILL.md frontmatter, evaluates `requires:` entries against the current
// environment, and reports anything missing so the user knows BEFORE they
// invoke a skill that would runtime-fail.
//
// Two requirement kinds (mutually exclusive per entry):
//   command — a CLI that must be on PATH (checked with Bun.which via hasCommand)
//   mcp     — an MCP server that must be registered in ~/.claude.json or in the
//             team mcpServers config

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type SkillFrontmatter, SkillFrontmatter as SkillSchema } from "../schemas/skill.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { CLAUDE_DIR, hasCommand } from "./platform.ts";

export interface MissingPrereq {
  kind: "command" | "mcp";
  name: string;
  install?: string;
}

export interface SkillPrereqReport {
  skill: string;
  missing: MissingPrereq[];
}

/** Read every skills/*\/SKILL.md, return the parsed + validated frontmatters. */
export async function readAllSkillFrontmatters(
  skillsDir: string,
): Promise<Array<{ name: string; frontmatter: SkillFrontmatter }>> {
  if (!existsSync(skillsDir)) return [];
  const out: Array<{ name: string; frontmatter: SkillFrontmatter }> = [];
  const entries = await readdir(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const text = await readFile(skillPath, "utf8");
    const fm = parseFrontmatter(text);
    if (!fm) continue;
    const result = SkillSchema.safeParse(fm);
    if (!result.success) continue;
    out.push({ name: entry.name, frontmatter: result.data });
  }
  return out;
}

/**
 * Read the union of MCP servers configured for this user — both the team-shipped
 * config (settings.json) and the user-personal store (~/.claude.json). Returns
 * a Set of server names.
 */
export async function readConfiguredMcpServers(claudeDir?: string): Promise<Set<string>> {
  const dir = claudeDir ?? CLAUDE_DIR;
  const sources = [join(dir, "settings.json"), join(homedir(), ".claude.json")];
  const names = new Set<string>();
  for (const path of sources) {
    if (!existsSync(path)) continue;
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
      for (const k of Object.keys(parsed.mcpServers ?? {})) names.add(k);
    } catch {
      // malformed JSON — skip
    }
  }
  return names;
}

/**
 * Evaluate one skill's `requires:` against the environment. Returns the list
 * of missing prereqs (empty when all are satisfied).
 */
export function checkSkillRequirements(
  frontmatter: SkillFrontmatter,
  configuredMcps: Set<string>,
): MissingPrereq[] {
  const requires = frontmatter.requires;
  if (!requires) return [];
  const missing: MissingPrereq[] = [];
  for (const req of requires) {
    if ("command" in req) {
      if (!hasCommand(req.command)) {
        missing.push({ kind: "command", name: req.command, install: req.install });
      }
    } else if ("mcp" in req) {
      if (!configuredMcps.has(req.mcp)) {
        missing.push({ kind: "mcp", name: req.mcp, install: req.install });
      }
    }
  }
  return missing;
}

/**
 * Check every skill in `skillsDir`, return a report per skill that has
 * missing prereqs. Skills with no `requires:` or all-satisfied prereqs are
 * omitted from the result.
 */
export async function reportMissingPrereqs(
  skillsDir: string,
  claudeDir?: string,
): Promise<SkillPrereqReport[]> {
  const [skills, mcps] = await Promise.all([
    readAllSkillFrontmatters(skillsDir),
    readConfiguredMcpServers(claudeDir),
  ]);
  const reports: SkillPrereqReport[] = [];
  for (const { name, frontmatter } of skills) {
    const missing = checkSkillRequirements(frontmatter, mcps);
    if (missing.length > 0) reports.push({ skill: name, missing });
  }
  return reports;
}

/**
 * Format the prereq-warning block for the install summary. Returns null when
 * there's nothing to warn about.
 */
export function formatPrereqWarnings(reports: SkillPrereqReport[]): string | null {
  if (reports.length === 0) return null;
  const lines = [
    `${reports.length} skill(s) have unmet prerequisites — they'll fail at runtime until installed:`,
  ];
  for (const { skill, missing } of reports) {
    lines.push(`  /${skill}:`);
    for (const m of missing) {
      const label = m.kind === "command" ? "CLI" : "MCP";
      const hint = m.install ? ` (${m.install})` : "";
      lines.push(`    • missing ${label}: ${m.name}${hint}`);
    }
  }
  return lines.join("\n");
}
