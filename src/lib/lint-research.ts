// RESEARCH.md shape validator. RESEARCH.md is the seam between /harvest and
// /autoresearch: harvest seeds it from trap prompts + quality bar (skills/harvest),
// and autoresearch parses it purely by structure — `## Test Inputs`, `## Checklist`,
// `## Settings` (skills/autoresearch). A malformed seed silently degrades the
// optimization loop (0 test inputs → nothing to sample; a non-numeric setting →
// NaN sampling), so this validates the shape deterministically before the loop runs.
//
// ResearchSeverity:
//   error   — autoresearch cannot parse it, or would run degenerate
//   warning — parseable but off the guidance sweet spot
//
// Imported by:
//   - src/scripts/lint-research.ts  — CLI (`bun run lint:research`)
//   - tests/lint-research.test.ts

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type ResearchSeverity = "error" | "warning";

export interface ResearchFinding {
  file: string;
  severity: ResearchSeverity;
  rule: string;
  message: string;
}

export interface ResearchResult {
  findings: ResearchFinding[];
  fileCount: number;
}

// autoresearch cycles test inputs round-robin; /harvest yields 2–3 traps. Fewer
// than 2 gives the loop almost nothing to generalize from.
export const MIN_TEST_INPUTS = 2;
// autoresearch guidance (skills/autoresearch "Guidelines for good checklists"):
// 3–7 is the sweet spot. Fewer under-measures; more invites checklist-gaming.
export const MIN_CHECKLIST = 3;
export const MAX_CHECKLIST = 7;

// Settings autoresearch reads as numbers. A non-numeric value here is the
// "unknown numbers must be null/INCONCLUSIVE, never aspirational" failure mode
// surfacing as an un-parseable seed (e.g. `samples: TBD`).
const NUMERIC_SETTINGS = new Set(["samples", "min_improvement", "max_rounds"]);

/** Group lines under their `## <heading>` (H2). H3+ (`### …`) stay as section
 *  content, so `### Test N:` lines are counted inside `## Test Inputs`. */
function parseSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    // H2 only: `##` + whitespace. `### Foo` has `#` at that position, so it
    // does not match and is treated as section content.
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2?.[1] !== undefined) {
      current = h2[1].toLowerCase();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) sections.get(current)?.push(line);
  }
  return sections;
}

/** Lint one RESEARCH.md's already-read content. `label` is the display path. */
export function lintResearchText(label: string, text: string): ResearchFinding[] {
  const findings: ResearchFinding[] = [];
  const push = (severity: ResearchSeverity, rule: string, message: string) =>
    findings.push({ file: label, severity, rule, message });

  const sections = parseSections(text);

  // --- Test Inputs ---
  const testLines = sections.get("test inputs");
  if (testLines === undefined) {
    push("error", "missing-test-inputs", "no `## Test Inputs` section");
  } else {
    const count = testLines.filter((l) => /^###\s+/.test(l)).length;
    if (count < MIN_TEST_INPUTS) {
      push(
        "error",
        "too-few-test-inputs",
        `${count} test input(s) (\`### …\` headings) — need at least ${MIN_TEST_INPUTS}`,
      );
    }
  }

  // --- Checklist ---
  const checklistLines = sections.get("checklist");
  if (checklistLines === undefined) {
    push("error", "missing-checklist", "no `## Checklist` section");
  } else {
    const count = checklistLines.filter((l) => /^\s*-\s*\[[ xX]?\]/.test(l)).length;
    if (count < MIN_CHECKLIST) {
      push(
        "error",
        "too-few-checklist",
        `${count} checklist item(s) (\`- [ ]\`) — need at least ${MIN_CHECKLIST}`,
      );
    } else if (count > MAX_CHECKLIST) {
      push(
        "warning",
        "too-many-checklist",
        `${count} checklist items — past the ${MAX_CHECKLIST}-item sweet spot; the skill starts gaming the checklist`,
      );
    }
  }

  // --- Settings (optional; validate values when present) ---
  const settingsLines = sections.get("settings");
  if (settingsLines) {
    for (const line of settingsLines) {
      const kv = line.match(/^\s*-\s*([a-z_]+)\s*:\s*(.+?)\s*$/i);
      const rawKey = kv?.[1];
      const rawValue = kv?.[2];
      if (rawKey === undefined || rawValue === undefined) continue;
      const key = rawKey.toLowerCase();
      if (NUMERIC_SETTINGS.has(key) && !Number.isFinite(Number(rawValue))) {
        push(
          "error",
          "non-numeric-setting",
          `setting \`${key}\` is "${rawValue}" — must be a number, not an aspirational placeholder`,
        );
      }
    }
  }

  return findings;
}

/** Lint an explicit list of RESEARCH.md file paths. */
export async function lintResearchFiles(paths: string[]): Promise<ResearchResult> {
  const findings: ResearchFinding[] = [];
  let fileCount = 0;
  for (const path of paths) {
    if (!existsSync(path)) {
      findings.push({
        file: path,
        severity: "error",
        rule: "not-found",
        message: "file does not exist",
      });
      continue;
    }
    fileCount++;
    findings.push(...lintResearchText(path, await readFile(path, "utf8")));
  }
  return { findings, fileCount };
}

/** Walk a skills/ directory and lint every `<skill>/RESEARCH.md` present. Absent
 *  RESEARCH.md is not an error — most skills never get one. */
export async function lintResearchDir(skillsDir: string): Promise<ResearchResult> {
  if (!existsSync(skillsDir)) return { findings: [], fileCount: 0 };
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(skillsDir, entry.name, "RESEARCH.md");
    if (existsSync(candidate)) paths.push(candidate);
  }
  return lintResearchFiles(paths);
}

export function formatFindings(result: ResearchResult): string {
  const errors = result.findings.filter((f) => f.severity === "error");
  const warnings = result.findings.filter((f) => f.severity === "warning");
  const lines: string[] = [`Linted ${result.fileCount} RESEARCH.md file(s).`];
  for (const f of result.findings) {
    const icon = f.severity === "error" ? "✖" : "⚠";
    lines.push(`  ${icon} ${f.file} [${f.rule}] ${f.message}`);
  }
  lines.push("");
  lines.push(`${errors.length} error(s), ${warnings.length} warning(s).`);
  return lines.join("\n");
}

export function hasErrors(result: ResearchResult): boolean {
  return result.findings.some((f) => f.severity === "error");
}
