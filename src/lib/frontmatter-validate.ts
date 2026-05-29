// Install-time frontmatter validation. Walks `agents/*.md`,
// `skills/*\/SKILL.md`, and `profiles/*.md`, parses each frontmatter,
// validates against the corresponding zod schema. Catches typos like
// `effort: xtreme`, `permissionMode: planning`, malformed kebab-case names,
// etc. before the installer ships a broken agent, skill, or profile to
// ~/.claude/.
//
// Non-fatal by design: a single bad agent shouldn't block install of the
// other 9 — we surface the error and continue. Fatal-mode is opt-in via
// the `strict` flag (used by tests).

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { AgentFrontmatter } from "../schemas/agent.ts";
import { ProfileFrontmatter } from "../schemas/profile.ts";
import { SkillFrontmatter } from "../schemas/skill.ts";
import { parseFrontmatter } from "./frontmatter.ts";

export interface FrontmatterIssue {
  kind: "agent" | "skill" | "profile";
  /** File path relative to the source root, e.g. "agents/explore.md" */
  path: string;
  /** Human-readable list of validation errors */
  errors: string[];
}

function formatZodError(err: z.ZodError): string[] {
  return err.issues.map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`);
}

async function validateAgents(sourceDir: string): Promise<FrontmatterIssue[]> {
  const dir = join(sourceDir, "agents");
  if (!existsSync(dir)) return [];
  const issues: FrontmatterIssue[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (entry.name === "README.md") continue;
    const path = `agents/${entry.name}`;
    const text = await readFile(join(dir, entry.name), "utf8");
    const fm = parseFrontmatter(text);
    if (!fm || typeof fm !== "object") {
      issues.push({ kind: "agent", path, errors: ["no parseable frontmatter"] });
      continue;
    }
    const result = AgentFrontmatter.safeParse(fm);
    if (!result.success) {
      issues.push({ kind: "agent", path, errors: formatZodError(result.error) });
    }
  }
  return issues;
}

async function validateSkills(sourceDir: string): Promise<FrontmatterIssue[]> {
  const dir = join(sourceDir, "skills");
  if (!existsSync(dir)) return [];
  const issues: FrontmatterIssue[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(dir, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const path = `skills/${entry.name}/SKILL.md`;
    const text = await readFile(skillPath, "utf8");
    const fm = parseFrontmatter(text);
    if (!fm || typeof fm !== "object") {
      issues.push({ kind: "skill", path, errors: ["no parseable frontmatter"] });
      continue;
    }
    const result = SkillFrontmatter.safeParse(fm);
    if (!result.success) {
      issues.push({ kind: "skill", path, errors: formatZodError(result.error) });
    }
  }
  return issues;
}

async function validateProfiles(sourceDir: string): Promise<FrontmatterIssue[]> {
  const dir = join(sourceDir, "profiles");
  if (!existsSync(dir)) return [];
  const issues: FrontmatterIssue[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (entry.name === "README.md") continue;
    const path = `profiles/${entry.name}`;
    const text = await readFile(join(dir, entry.name), "utf8");
    const fm = parseFrontmatter(text);
    if (!fm || typeof fm !== "object") {
      issues.push({ kind: "profile", path, errors: ["no parseable frontmatter"] });
      continue;
    }
    const result = ProfileFrontmatter.safeParse(fm);
    if (!result.success) {
      issues.push({ kind: "profile", path, errors: formatZodError(result.error) });
    }
  }
  return issues;
}

/**
 * Walk `agents/`, `skills/`, and `profiles/`, validate each frontmatter,
 * return the combined list of issues. Empty array means everything parsed cleanly.
 */
export async function validateFrontmatters(sourceDir: string): Promise<FrontmatterIssue[]> {
  const [agentIssues, skillIssues, profileIssues] = await Promise.all([
    validateAgents(sourceDir),
    validateSkills(sourceDir),
    validateProfiles(sourceDir),
  ]);
  return [...agentIssues, ...skillIssues, ...profileIssues];
}

/**
 * Format the issue list for the installer. Returns null when there are no
 * issues. The block is shown as a warning, not an error — install continues.
 */
export function formatFrontmatterIssues(issues: FrontmatterIssue[]): string | null {
  if (issues.length === 0) return null;
  const lines = [
    `${issues.length} frontmatter issue(s) — these agents/skills/profiles will load with degraded behavior:`,
  ];
  for (const issue of issues) {
    lines.push(`  ${issue.path}:`);
    for (const err of issue.errors) lines.push(`    ${err}`);
  }
  return lines.join("\n");
}
