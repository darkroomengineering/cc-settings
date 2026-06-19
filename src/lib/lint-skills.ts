// Skill library linter. Mechanizes the validation checklist from Anthropic's
// "Complete Guide to Building Skills for Claude" (Reference A) plus Darkroom-
// specific conventions. Walks skills/<name>/SKILL.md and reports problems.
//
// SkillSeverity:
//   error   — blocks (CI fails, lint:skills exits non-zero)
//   warning — surfaced but non-blocking

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SkillFrontmatter } from "../schemas/skill.ts";
import { lintFrontmatterCore } from "./lint-frontmatter.ts";
import { ACTIVE_SKILLS } from "./managed-skills.ts";

export type SkillSeverity = "error" | "warning";

export interface LintFinding {
  skill: string;
  severity: SkillSeverity;
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

// Heuristic: a "good" description per the guide includes BOTH what + when.
// We approximate "when" by looking for trigger language: explicit "Triggers",
// "Use when", "Use for", "Used for", "when user", "when you". Doesn't catch
// every valid phrasing but flags the obvious misses ("Helps with projects").
const TRIGGER_PATTERN = /(triggers?|use (when|for)|used for|when (user|you)|after\b)/i;

async function lintOne(skillsDir: string, name: string): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];
  const dir = join(skillsDir, name);
  const skillPath = join(dir, "SKILL.md");

  // Helper: attach the skill name to a base finding.
  const push = (severity: SkillSeverity, rule: string, message: string) => {
    findings.push({ skill: name, severity, rule, message });
  };

  if (!KEBAB_CASE.test(name)) {
    push("error", "folder-kebab-case", `folder "${name}" is not kebab-case (allowed: a-z, 0-9, -)`);
  }

  for (const prefix of RESERVED_PREFIXES) {
    if (name === prefix || name.startsWith(`${prefix}-`)) {
      push(
        "error",
        "reserved-name",
        `name "${name}" uses reserved prefix "${prefix}" — Claude.ai rejects these`,
      );
    }
  }

  // The guide is explicit: no README.md inside a skill folder. All docs go in
  // SKILL.md or references/.
  if (existsSync(join(dir, "README.md"))) {
    push(
      "error",
      "no-readme-inside",
      "README.md found inside skill folder — move docs to SKILL.md or references/",
    );
  }

  if (!existsSync(skillPath)) {
    push("error", "skill-md-missing", "SKILL.md not found (exact case required)");
    return findings;
  }

  const text = await readFile(skillPath, "utf8");

  // Raw-text scan: catches angle brackets in any field, including passthrough
  // ones like argument-hint where the schema doesn't validate the value.
  // Must run before frontmatter parsing so we scan the raw block.
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  if (/[<>]/.test(block)) {
    push(
      "error",
      "no-angle-brackets",
      "frontmatter contains `<` or `>` — security restriction, frontmatter is injected into the system prompt",
    );
  }

  // Shared scaffolding: frontmatter-missing + yaml-parse errors.
  const baseFindings = await lintFrontmatterCore(text, (parsed) => {
    const domainFindings: Array<{ severity: SkillSeverity; rule: string; message: string }> = [];

    const result = SkillFrontmatter.safeParse(parsed);
    if (!result.success) {
      for (const issue of result.error.issues) {
        domainFindings.push({
          severity: "error",
          rule: "schema",
          message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        });
      }
      return domainFindings;
    }

    const fm = result.data;

    if (fm.name !== name) {
      domainFindings.push({
        severity: "error",
        rule: "name-folder-mismatch",
        message: `frontmatter name "${fm.name}" does not match folder "${name}"`,
      });
    }

    const desc = fm.description;

    // Guide: under 1024 chars. Hard limit (Claude.ai upload rejects past this).
    if (desc.length > 1024) {
      domainFindings.push({
        severity: "error",
        rule: "description-too-long",
        message: `description is ${desc.length} chars (max 1024)`,
      });
    }

    // Guide examples of "too vague" descriptions hover around 25-40 chars
    // ("Helps with projects."). 50 is a soft floor — flag as warning, don't block.
    if (desc.length < 50) {
      domainFindings.push({
        severity: "warning",
        rule: "description-too-short",
        message: `description is only ${desc.length} chars — likely too vague to trigger reliably`,
      });
    }

    if (!TRIGGER_PATTERN.test(desc)) {
      domainFindings.push({
        severity: "warning",
        rule: "description-no-trigger-language",
        message:
          "description has no trigger language (`Triggers`, `Use when`, `Use for`, …) — the model can't tell when to load it",
      });
    }

    return domainFindings;
  });

  for (const f of baseFindings) {
    findings.push({ skill: name, severity: f.severity, rule: f.rule, message: f.message });
  }

  return findings;
}

export async function lintSkillsDir(
  skillsDir: string,
  opts: { checkManaged?: boolean } = {},
): Promise<LintResult> {
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

  // ACTIVE_SKILLS must match skills/ on disk exactly. A skill present on disk but
  // absent from ACTIVE_SKILLS won't be pruned on a full→light switch (cleanOldConfig
  // iterates ACTIVE_SKILLS); an ACTIVE_SKILLS entry with no directory is stale.
  // Repo-level invariant — only meaningful against the canonical skills/ dir, so
  // it is opt-in (the CLI enables it for the default repo run, not custom dirs).
  if (opts.checkManaged) {
    const onDisk = new Set(skillNames);
    const active = new Set(ACTIVE_SKILLS);
    for (const name of skillNames) {
      if (!active.has(name)) {
        findings.push({
          skill: name,
          severity: "error",
          rule: "managed-skills-missing",
          message:
            "present in skills/ but missing from ACTIVE_SKILLS (src/lib/managed-skills.ts) — the installer won't prune it on a full→light switch",
        });
      }
    }
    for (const name of ACTIVE_SKILLS) {
      if (!onDisk.has(name)) {
        findings.push({
          skill: name,
          severity: "error",
          rule: "managed-skills-stale",
          message:
            "listed in ACTIVE_SKILLS but skills/<name>/ does not exist — remove it or move it to TOMBSTONE_SKILLS",
        });
      }
    }
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
