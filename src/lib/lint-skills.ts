// Skill library linter. Mechanizes the validation checklist from Anthropic's
// "Complete Guide to Building Skills for Claude" (Reference A) plus Darkroom-
// specific conventions. Walks skills/<name>/SKILL.md and reports problems.
//
// Severity:
//   error   — blocks (CI fails, lint:skills exits non-zero)
//   warning — surfaced but non-blocking

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { SkillFrontmatter } from "../schemas/skill.ts";

export type Severity = "error" | "warning";

export interface LintFinding {
  skill: string;
  severity: Severity;
  rule: string;
  message: string;
}

export interface LintResult {
  findings: LintFinding[];
  skillCount: number;
}

// Soft cap from Anthropic's guide (Chapter 5, Large Context Issues). Past this
// point, the Skill tool selector has to read too many descriptions per turn.
// Adding a skill past the cap should require removing one — see CLAUDE-FULL.md.
export const SKILL_SOFT_CAP = 40;

// Reference A: name kebab-case, no underscores/capitals/spaces.
const KEBAB_CASE = /^[a-z][a-z0-9-]*$/;

// Reserved per the guide — Claude.ai rejects uploads named these.
const RESERVED_PREFIXES = ["claude", "anthropic"];

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

// Heuristic: a "good" description per the guide includes BOTH what + when.
// We approximate "when" by looking for trigger language: explicit "Triggers",
// "Use when", "Use for", "Used for", "when user", "when you". Doesn't catch
// every valid phrasing but flags the obvious misses ("Helps with projects").
const TRIGGER_PATTERN = /(triggers?|use (when|for)|used for|when (user|you)|after\b)/i;

function extractFrontmatterBlock(md: string): string | null {
  const m = FRONTMATTER_RE.exec(md);
  return m ? (m[1] ?? "") : null;
}

async function lintOne(skillsDir: string, name: string): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];
  const dir = join(skillsDir, name);
  const skillPath = join(dir, "SKILL.md");

  if (!KEBAB_CASE.test(name)) {
    findings.push({
      skill: name,
      severity: "error",
      rule: "folder-kebab-case",
      message: `folder "${name}" is not kebab-case (allowed: a-z, 0-9, -)`,
    });
  }

  for (const prefix of RESERVED_PREFIXES) {
    if (name === prefix || name.startsWith(`${prefix}-`)) {
      findings.push({
        skill: name,
        severity: "error",
        rule: "reserved-name",
        message: `name "${name}" uses reserved prefix "${prefix}" — Claude.ai rejects these`,
      });
    }
  }

  // The guide is explicit: no README.md inside a skill folder. All docs go in
  // SKILL.md or references/.
  if (existsSync(join(dir, "README.md"))) {
    findings.push({
      skill: name,
      severity: "error",
      rule: "no-readme-inside",
      message: "README.md found inside skill folder — move docs to SKILL.md or references/",
    });
  }

  if (!existsSync(skillPath)) {
    findings.push({
      skill: name,
      severity: "error",
      rule: "skill-md-missing",
      message: "SKILL.md not found (exact case required)",
    });
    return findings;
  }

  const text = await readFile(skillPath, "utf8");
  const block = extractFrontmatterBlock(text);

  if (!block) {
    findings.push({
      skill: name,
      severity: "error",
      rule: "frontmatter-missing",
      message: "no `---`-delimited YAML frontmatter at top of file",
    });
    return findings;
  }

  // Raw-text scan: catches angle brackets in any field, including passthrough
  // ones like argument-hint where the schema doesn't validate the value.
  if (/[<>]/.test(block)) {
    findings.push({
      skill: name,
      severity: "error",
      rule: "no-angle-brackets",
      message:
        "frontmatter contains `<` or `>` — security restriction, frontmatter is injected into the system prompt",
    });
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(block);
  } catch (err) {
    findings.push({
      skill: name,
      severity: "error",
      rule: "yaml-parse",
      message: `YAML parse failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return findings;
  }

  const result = SkillFrontmatter.safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      findings.push({
        skill: name,
        severity: "error",
        rule: "schema",
        message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      });
    }
    return findings;
  }

  const fm = result.data;

  if (fm.name !== name) {
    findings.push({
      skill: name,
      severity: "error",
      rule: "name-folder-mismatch",
      message: `frontmatter name "${fm.name}" does not match folder "${name}"`,
    });
  }

  const desc = fm.description;

  // Guide: under 1024 chars. Hard limit (Claude.ai upload rejects past this).
  if (desc.length > 1024) {
    findings.push({
      skill: name,
      severity: "error",
      rule: "description-too-long",
      message: `description is ${desc.length} chars (max 1024)`,
    });
  }

  // Guide examples of "too vague" descriptions hover around 25-40 chars
  // ("Helps with projects."). 50 is a soft floor — flag as warning, don't block.
  if (desc.length < 50) {
    findings.push({
      skill: name,
      severity: "warning",
      rule: "description-too-short",
      message: `description is only ${desc.length} chars — likely too vague to trigger reliably`,
    });
  }

  if (!TRIGGER_PATTERN.test(desc)) {
    findings.push({
      skill: name,
      severity: "warning",
      rule: "description-no-trigger-language",
      message:
        "description has no trigger language (`Triggers`, `Use when`, `Use for`, …) — the model can't tell when to load it",
    });
  }

  return findings;
}

export async function lintSkillsDir(skillsDir: string): Promise<LintResult> {
  if (!existsSync(skillsDir)) {
    return { findings: [], skillCount: 0 };
  }

  const findings: LintFinding[] = [];
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skillNames: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    skillNames.push(entry.name);
  }

  for (const name of skillNames) {
    findings.push(...(await lintOne(skillsDir, name)));
  }

  if (skillNames.length > SKILL_SOFT_CAP) {
    findings.push({
      skill: "(repo)",
      severity: "warning",
      rule: "skill-count-cap",
      message: `${skillNames.length} skills — past ${SKILL_SOFT_CAP}-skill soft cap. Adding a new skill should require removing one.`,
    });
  }

  return { findings, skillCount: skillNames.length };
}

export function formatFindings(result: LintResult): string {
  const errors = result.findings.filter((f) => f.severity === "error");
  const warnings = result.findings.filter((f) => f.severity === "warning");

  const lines: string[] = [];
  lines.push(`Linted ${result.skillCount} skill(s).`);

  for (const f of result.findings) {
    const icon = f.severity === "error" ? "✖" : "⚠";
    lines.push(`  ${icon} ${f.skill} [${f.rule}] ${f.message}`);
  }

  lines.push("");
  lines.push(`${errors.length} error(s), ${warnings.length} warning(s).`);
  return lines.join("\n");
}

// For consumers that just want to gate CI on errors only.
export function hasErrors(result: LintResult): boolean {
  return result.findings.some((f) => f.severity === "error");
}
