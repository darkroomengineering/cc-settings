// Install-time frontmatter validation. Walks `agents/*.md`,
// `skills/*\/SKILL.md`, and `profiles/*.md`, parses each frontmatter with
// `parseFrontmatterStrict` (the same strict YAML path CI's lint:skills /
// lint:knowledge / lint:agents / lint:profiles use), validates against the
// corresponding zod schema. Catches typos like `effort: xtreme`,
// `permissionMode: planning`, malformed kebab-case names, AND duplicate
// top-level keys (e.g. two `model:` lines from a bad merge) — the loose
// parser silently took the last one, strict flags it — before the installer
// ships a broken agent, skill, or profile to ~/.claude/.
//
// Non-fatal by design: a single bad agent shouldn't block install of the
// other 9 — we surface the error (including strict parse failures) and
// continue. There is no separate fatal-mode flag here; callers that want a
// hard gate (CI) use the dedicated lint:* scripts instead, which exit
// non-zero on error-severity findings.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { AgentFrontmatter } from "../schemas/agent.ts";
import { ProfileFrontmatter } from "../schemas/profile.ts";
import { SkillFrontmatter } from "../schemas/skill.ts";
import { parseFrontmatterStrict } from "./frontmatter.ts";

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

// One walker, three configurations. The per-kind walkers only ever differed
// in directory, file layout, and schema — a table keeps them in lockstep.
interface WalkSpec {
  kind: FrontmatterIssue["kind"];
  /** Directory under sourceDir to walk. */
  dir: string;
  /**
   * "flat-md": top-level *.md files (README.md excluded).
   * "skill-dirs": <name>/SKILL.md inside each subdirectory.
   */
  layout: "flat-md" | "skill-dirs";
  schema: z.ZodType;
}

const WALK_SPECS: WalkSpec[] = [
  { kind: "agent", dir: "agents", layout: "flat-md", schema: AgentFrontmatter },
  { kind: "skill", dir: "skills", layout: "skill-dirs", schema: SkillFrontmatter },
  { kind: "profile", dir: "profiles", layout: "flat-md", schema: ProfileFrontmatter },
];

/** Candidate files as "/"-separated paths relative to the walked dir. */
async function listCandidates(dir: string, layout: WalkSpec["layout"]): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  if (layout === "flat-md") {
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "README.md")
      .map((e) => e.name);
  }
  return entries
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "SKILL.md")))
    .map((e) => `${e.name}/SKILL.md`);
}

async function validateKind(sourceDir: string, spec: WalkSpec): Promise<FrontmatterIssue[]> {
  const dir = join(sourceDir, spec.dir);
  if (!existsSync(dir)) return [];
  const issues: FrontmatterIssue[] = [];
  for (const rel of await listCandidates(dir, spec.layout)) {
    const path = `${spec.dir}/${rel}`;
    const text = await readFile(join(dir, ...rel.split("/")), "utf8");
    // Strict path: catches duplicate top-level keys (last-wins is silent
    // under the loose parser) and surfaces real YAML syntax errors instead
    // of swallowing them into a generic "no parseable frontmatter". Still
    // non-fatal here — degrade-with-warning, not abort-install (see header
    // note); the caller only ever surfaces `issues` as a warning block.
    const { data: fm, errors: parseErrors } = parseFrontmatterStrict(text);
    if (parseErrors.length > 0) {
      issues.push({ kind: spec.kind, path, errors: parseErrors.map((e) => e.message) });
      continue;
    }
    if (!fm || typeof fm !== "object") {
      issues.push({ kind: spec.kind, path, errors: ["no parseable frontmatter"] });
      continue;
    }
    const result = spec.schema.safeParse(fm);
    if (!result.success) {
      issues.push({ kind: spec.kind, path, errors: formatZodError(result.error) });
    }
  }
  return issues;
}

/**
 * Walk `agents/`, `skills/`, and `profiles/`, validate each frontmatter,
 * return the combined list of issues. Empty array means everything parsed cleanly.
 */
export async function validateFrontmatters(sourceDir: string): Promise<FrontmatterIssue[]> {
  const perKind = await Promise.all(WALK_SPECS.map((spec) => validateKind(sourceDir, spec)));
  return perKind.flat();
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
