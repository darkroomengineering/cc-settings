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
import { extractFrontmatterBlock, KEBAB_CASE_RE } from "./frontmatter.ts";
import {
  formatLintFindings,
  hasLintErrors,
  type LintSeverity,
  lintFrontmatterCore,
} from "./lint-frontmatter.ts";
import { ACTIVE_SKILLS } from "./managed-skills.ts";

export type SkillSeverity = LintSeverity;

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

// Ratchet baseline, not a target. Anthropic's guide (Chapter 5, Large Context
// Issues) puts 20–50 skills as the band where the Skill tool selector starts
// struggling to read every description per turn. The number below is the count
// we are currently allowed to have, and it may only descend.
//
// History: merged `nuclear-review` + `adversarial-audit` -> `audit` (Aug 2026),
// baseline lowered 39 -> 38 accordingly — the two goal-specs (maintainability
// vs correctness) survive as modes of one skill instead of two lexically
// ambiguous entry points ("audit the codebase" used to route to either).
//
//   count > baseline -> error. Consolidate or remove one. Raising this is a
//                       deliberate, reviewable commit, never a side effect.
//   count < baseline -> error. Lower it here and commit, so the ratchet holds
//                       the new floor instead of leaving slack to drift back.
//
// Both directions are errors on purpose: that is what keeps every movement of
// the number in git history. The previous version of this rule fired a warning
// at >40 and CI never failed on it, so the only thing standing between us and a
// 45-skill library was prose in CLAUDE-FULL.md. Advisory output is ignorable; a
// non-zero exit is not.
//
// What this does NOT do: stop someone raising the baseline in the same commit
// that adds the skill. The linter only compares against whatever the constant
// currently says. "Descend-only" is enforced by the diff being visible in review,
// not by this file — which is the intended trade, since a legitimate raise has to
// stay possible. Verifying a baseline against its merge-base is a CI-side job.
export const SKILL_COUNT_BASELINE = 38;

// The count ratchet above is a proxy — the real per-turn cost is the byte size
// of the name+description index the Skill selector reads every turn, not the
// number of skills contributing to it. OpenAI Codex caps its equivalent
// skill-index surface at 2% of context or 8,000 chars
// (learn.chatgpt.com/docs/build-skills); our descriptions totaled ~11.7 KB in
// Aug 2026 when this was added, already over that reference cap.
//
// Unlike SKILL_COUNT_BASELINE this is a ceiling, not a two-way ratchet: the
// total fluctuates with normal description edits (tightening one description
// while lengthening another nets zero), so only exceeding the budget is an
// error. The fix for a violation is tightening the longest descriptions, not
// raising this constant.
export const SKILL_DESCRIPTION_BYTE_BUDGET = 12288;

// Reference A: name kebab-case, no underscores/capitals/spaces. Shared with
// the schema `name` field regexes (agent/skill/profile/knowledge) — see
// KEBAB_CASE_RE in frontmatter.ts for why this used to disagree with them.
const KEBAB_CASE = KEBAB_CASE_RE;

// Reserved per the guide — Claude.ai rejects uploads named these.
const RESERVED_PREFIXES = ["claude", "anthropic"];

// Heuristic: a "good" description per the guide includes BOTH what + when.
// We approximate "when" by looking for trigger language: explicit "Triggers",
// "Use when", "Use for", "Used for", "when user", "when you". Doesn't catch
// every valid phrasing but flags the obvious misses ("Helps with projects").
const TRIGGER_PATTERN = /(triggers?|use (when|for)|used for|when (user|you)|after\b)/i;

interface LintOneResult {
  findings: LintFinding[];
  // Byte length of the frontmatter `description` field, or 0 when the
  // frontmatter doesn't parse (schema errors already cover that case).
  descriptionBytes: number;
}

async function lintOne(skillsDir: string, name: string): Promise<LintOneResult> {
  const findings: LintFinding[] = [];
  let descriptionBytes = 0;
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
    return { findings, descriptionBytes };
  }

  const text = await readFile(skillPath, "utf8");

  // Raw-text scan: catches angle brackets in any field, including passthrough
  // ones like argument-hint where the schema doesn't validate the value.
  // Must run before frontmatter parsing so we scan the raw block.
  const block = extractFrontmatterBlock(text) ?? "";
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
    descriptionBytes = Buffer.byteLength(desc, "utf8");

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

  return { findings, descriptionBytes };
}

export async function lintSkillsDir(
  skillsDir: string,
  opts: {
    checkManaged?: boolean;
    // Test-only override for SKILL_DESCRIPTION_BYTE_BUDGET — the constant itself
    // stays fixed for real runs. checkManaged also gates the count ratchet and
    // ACTIVE_SKILLS parity, so a fixture dir can't cleanly exercise the byte
    // budget in isolation without this.
    descriptionByteBudget?: number;
  } = {},
): Promise<LintResult> {
  if (!existsSync(skillsDir)) {
    // A missing custom dir is a no-op, but the canonical skills/ going missing is
    // a failure worth shouting about: without this branch, deleting the entire
    // library lints clean, because every check below iterates zero entries.
    const findings: LintFinding[] = opts.checkManaged
      ? [
          {
            skill: "(repo)",
            severity: "error",
            rule: "skills-dir-missing",
            message: `${skillsDir} does not exist — the managed skill library is gone`,
          },
        ]
      : [];
    return { findings, skillCount: 0 };
  }

  const findings: LintFinding[] = [];
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skillNames: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    skillNames.push(entry.name);
  }

  const descriptionBytesBySkill: Array<{ name: string; bytes: number }> = [];
  let totalDescriptionBytes = 0;

  for (const name of skillNames) {
    const { findings: skillFindings, descriptionBytes } = await lintOne(skillsDir, name);
    findings.push(...skillFindings);
    descriptionBytesBySkill.push({ name, bytes: descriptionBytes });
    totalDescriptionBytes += descriptionBytes;
  }

  // Same opt-in as the count ratchet: index-byte totals are only meaningful
  // against the canonical skills/ dir, not a small test fixture.
  if (opts.checkManaged) {
    const budget = opts.descriptionByteBudget ?? SKILL_DESCRIPTION_BYTE_BUDGET;
    if (totalDescriptionBytes > budget) {
      const topOffenders = [...descriptionBytesBySkill]
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 3)
        .map((s) => `${s.name} (${s.bytes}B)`)
        .join(", ");
      findings.push({
        skill: "(repo)",
        severity: "error",
        rule: "description-byte-budget",
        message: `skill descriptions total ${totalDescriptionBytes} bytes, budget ${budget} — tighten the longest descriptions instead of raising SKILL_DESCRIPTION_BYTE_BUDGET (src/lib/lint-skills.ts). Largest: ${topOffenders}`,
      });
    }
  }

  // Repo-level invariant, so it rides the same opt-in as the ACTIVE_SKILLS parity
  // check below: a baseline of 40 is meaningless against a 2-skill test fixture.
  if (opts.checkManaged && skillNames.length !== SKILL_COUNT_BASELINE) {
    const count = skillNames.length;
    findings.push({
      skill: "(repo)",
      severity: "error",
      rule: "skill-count-ratchet",
      message:
        count > SKILL_COUNT_BASELINE
          ? `${count} skills, baseline ${SKILL_COUNT_BASELINE} — consolidate or remove one instead of raising SKILL_COUNT_BASELINE (src/lib/lint-skills.ts)`
          : `${count} skills, baseline ${SKILL_COUNT_BASELINE} — ratchet down: set SKILL_COUNT_BASELINE to ${count} in src/lib/lint-skills.ts and commit it`,
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
  return formatLintFindings(result.findings, result.skillCount, {
    noun: "skill",
    getItem: (f) => f.skill,
  });
}

// For consumers that just want to gate CI on errors only.
export function hasErrors(result: LintResult): boolean {
  return hasLintErrors(result.findings);
}
