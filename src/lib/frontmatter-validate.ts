// Install-time frontmatter validation. Delegates to the same pipelines CI's
// lint:agents / lint:skills / lint:profiles use (lintAgentsDir / lintSkillsDir
// / lintProfilesDir), then narrows their findings down to the subset that
// corresponds to "does this file parse and validate": frontmatter-missing,
// yaml-parse (incl. duplicate top-level keys, e.g. two `model:` lines from a
// bad merge), and schema (zod) failures. The linters also check things this
// install-time gate never has — angle brackets, folder/name kebab-case,
// README presence, name/folder mismatches, description length — those are
// intentionally excluded here so behavior matches the prior hand-rolled
// walker exactly.
//
// Non-fatal by design: a single bad agent shouldn't block install of the
// other 9 — we surface the error (including strict parse failures) and
// continue. There is no separate fatal-mode flag here; callers that want a
// hard gate (CI) use the dedicated lint:* scripts instead, which exit
// non-zero on error-severity findings.

import { join } from "node:path";
import { lintAgentsDir } from "./lint-agents.ts";
import { lintProfilesDir } from "./lint-profiles.ts";
import { lintSkillsDir } from "./lint-skills.ts";

export interface FrontmatterIssue {
  kind: "agent" | "skill" | "profile";
  /** File path relative to the source root, e.g. "agents/explore.md" */
  path: string;
  /** Human-readable list of validation errors */
  errors: string[];
}

// Rule identifiers from the lint*Dir pipelines that map onto this gate's
// historical checks (parse failure or schema validation failure). Everything
// else the linters check (no-angle-brackets, folder-kebab-case, reserved-name,
// no-readme-inside, skill-md-missing, name-*-mismatch, description-*) is out
// of scope for install-time validation and stays CI-only.
const RELEVANT_RULES = new Set(["frontmatter-missing", "yaml-parse", "schema"]);

// The pre-refactor walker reported this exact string for both "no `---`
// block at all" and "frontmatter parsed to a non-object". Kept verbatim so
// existing consumers of the literal text are unaffected.
const NO_PARSEABLE_FRONTMATTER = "no parseable frontmatter";

function mapMessage(rule: string, message: string): string {
  return rule === "frontmatter-missing" ? NO_PARSEABLE_FRONTMATTER : message;
}

/** Group relevant findings by file path, in first-seen order. */
function collectIssues<F extends { severity: string; rule: string; message: string }>(
  findings: F[],
  pathOf: (f: F) => string,
): Array<{ path: string; errors: string[] }> {
  const order: string[] = [];
  const byPath = new Map<string, string[]>();
  for (const f of findings) {
    if (!RELEVANT_RULES.has(f.rule)) continue;
    const path = pathOf(f);
    let errors = byPath.get(path);
    if (!errors) {
      errors = [];
      byPath.set(path, errors);
      order.push(path);
    }
    errors.push(mapMessage(f.rule, f.message));
  }
  return order.map((path) => ({ path, errors: byPath.get(path) ?? [] }));
}

/**
 * Walk `agents/`, `skills/`, and `profiles/` (via the shared lint*Dir
 * pipelines), validate each frontmatter, return the combined list of issues.
 * Empty array means everything parsed cleanly.
 */
export async function validateFrontmatters(sourceDir: string): Promise<FrontmatterIssue[]> {
  const [agents, skills, profiles] = await Promise.all([
    lintAgentsDir(join(sourceDir, "agents")),
    lintSkillsDir(join(sourceDir, "skills")),
    lintProfilesDir(join(sourceDir, "profiles")),
  ]);

  const issues: FrontmatterIssue[] = [];

  for (const { path, errors } of collectIssues(agents.findings, (f) => `agents/${f.agent}.md`)) {
    issues.push({ kind: "agent", path, errors });
  }
  for (const { path, errors } of collectIssues(
    skills.findings,
    (f) => `skills/${f.skill}/SKILL.md`,
  )) {
    issues.push({ kind: "skill", path, errors });
  }
  for (const { path, errors } of collectIssues(
    profiles.findings,
    (f) => `profiles/${f.profile}.md`,
  )) {
    issues.push({ kind: "profile", path, errors });
  }

  return issues;
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
