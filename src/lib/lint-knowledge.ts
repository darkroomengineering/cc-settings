// Knowledge-note linter. Validates frontmatter in each <name>.md file in a
// team-knowledge repo directory.
//
// KnowledgeSeverity:
//   error   — blocks (CI fails, lint:knowledge exits non-zero)
//   warning — surfaced but non-blocking

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { KnowledgeFrontmatter } from "../schemas/knowledge.ts";
import { extractFrontmatterBlock, parseFrontmatterStrict } from "./frontmatter.ts";

export type KnowledgeSeverity = "error" | "warning";

export interface KnowledgeFinding {
  note: string;
  severity: KnowledgeSeverity;
  rule: string;
  message: string;
}

export interface KnowledgeLintResult {
  findings: KnowledgeFinding[];
  noteCount: number;
}

// Files to skip at the root of the knowledge repo (repo meta, not notes).
const SKIP_FILES = new Set(["README.md", "INDEX.md", "CONTRIBUTING.md"]);

function bodyAfterFrontmatter(md: string): string {
  // Body starts after the closing --- of the frontmatter block.
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)/.exec(md);
  return match ? (match[1] ?? "") : md;
}

async function lintOne(
  dir: string,
  filename: string,
  allNames: Set<string>,
): Promise<KnowledgeFinding[]> {
  const findings: KnowledgeFinding[] = [];
  const stem = basename(filename, extname(filename));
  const notePath = join(dir, filename);

  const text = await readFile(notePath, "utf8");
  const block = extractFrontmatterBlock(text);

  if (!block) {
    findings.push({
      note: filename,
      severity: "error",
      rule: "frontmatter-missing",
      message: "no `---`-delimited YAML frontmatter at top of file",
    });
    return findings;
  }

  const { data: parsed, errors: yamlErrors } = parseFrontmatterStrict(text);
  if (yamlErrors.length > 0) {
    for (const e of yamlErrors) {
      findings.push({
        note: filename,
        severity: "error",
        rule: "yaml-parse",
        message: `${e.code ?? "YAML"} at line ${e.line ?? "?"}, col ${e.col ?? "?"}: ${e.message}`,
      });
    }
    return findings;
  }

  const result = KnowledgeFrontmatter.safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      findings.push({
        note: filename,
        severity: "error",
        rule: "schema",
        message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      });
    }
    return findings;
  }

  const fm = result.data;

  // name must equal the filename stem.
  if (fm.name !== stem) {
    findings.push({
      note: filename,
      severity: "error",
      rule: "name-filename-mismatch",
      message: `frontmatter name "${fm.name}" does not match filename stem "${stem}"`,
    });
  }

  // supersedes must reference a name that exists in the directory.
  if (fm.supersedes !== undefined && !allNames.has(fm.supersedes)) {
    findings.push({
      note: filename,
      severity: "warning",
      rule: "supersedes-unknown",
      message: `supersedes "${fm.supersedes}" does not match any note name in this directory`,
    });
  }

  // Body must be non-empty (meaningful content after frontmatter).
  const body = bodyAfterFrontmatter(text).trim();
  if (!body) {
    findings.push({
      note: filename,
      severity: "error",
      rule: "empty-body",
      message: "note body is empty — add what/why/how-to-apply content",
    });
  }

  return findings;
}

export async function lintKnowledgeDir(dir: string): Promise<KnowledgeLintResult> {
  if (!existsSync(dir)) {
    return { findings: [], noteCount: 0 };
  }

  const findings: KnowledgeFinding[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md") && !SKIP_FILES.has(e.name))
    .map((e) => e.name);

  // Build a set of all note stems for supersedes cross-reference checks.
  const allNames = new Set(mdFiles.map((f) => basename(f, ".md")));

  for (const filename of mdFiles) {
    findings.push(...(await lintOne(dir, filename, allNames)));
  }

  return { findings, noteCount: mdFiles.length };
}

export function formatKnowledgeFindings(result: KnowledgeLintResult): string {
  const errors = result.findings.filter((f) => f.severity === "error");
  const warnings = result.findings.filter((f) => f.severity === "warning");

  const lines: string[] = [];
  lines.push(`Linted ${result.noteCount} note(s).`);

  for (const f of result.findings) {
    const icon = f.severity === "error" ? "✖" : "⚠";
    lines.push(`  ${icon} ${f.note} [${f.rule}] ${f.message}`);
  }

  lines.push("");
  lines.push(`${errors.length} error(s), ${warnings.length} warning(s).`);
  return lines.join("\n");
}

export function hasKnowledgeErrors(result: KnowledgeLintResult): boolean {
  return result.findings.some((f) => f.severity === "error");
}
