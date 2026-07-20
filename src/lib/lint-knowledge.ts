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
import { NON_NOTE_FILES } from "./knowledge-index.ts";
import {
  formatLintFindings,
  hasLintErrors,
  type LintSeverity,
  lintFrontmatterCore,
} from "./lint-frontmatter.ts";

export type KnowledgeSeverity = LintSeverity;

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

  // Helper: attach the note filename to a base finding.
  const push = (severity: KnowledgeSeverity, rule: string, message: string) => {
    findings.push({ note: filename, severity, rule, message });
  };

  const text = await readFile(notePath, "utf8");

  // Shared scaffolding: frontmatter-missing + yaml-parse errors.
  const baseFindings = await lintFrontmatterCore(text, (parsed) => {
    const domainFindings: Array<{ severity: KnowledgeSeverity; rule: string; message: string }> =
      [];

    const result = KnowledgeFrontmatter.safeParse(parsed);
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

    // name must equal the filename stem.
    if (fm.name !== stem) {
      domainFindings.push({
        severity: "error",
        rule: "name-filename-mismatch",
        message: `frontmatter name "${fm.name}" does not match filename stem "${stem}"`,
      });
    }

    // supersedes must reference a name that exists in the directory.
    if (fm.supersedes !== undefined && !allNames.has(fm.supersedes)) {
      domainFindings.push({
        severity: "warning",
        rule: "supersedes-unknown",
        message: `supersedes "${fm.supersedes}" does not match any note name in this directory`,
      });
    }

    // Body must be non-empty (meaningful content after frontmatter).
    const body = bodyAfterFrontmatter(text).trim();
    if (!body) {
      domainFindings.push({
        severity: "error",
        rule: "empty-body",
        message: "note body is empty — add what/why/how-to-apply content",
      });
    }

    return domainFindings;
  });

  for (const f of baseFindings) {
    push(f.severity, f.rule, f.message);
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
    .filter((e) => e.isFile() && e.name.endsWith(".md") && !NON_NOTE_FILES.has(e.name))
    .map((e) => e.name);

  // Build a set of all note stems for supersedes cross-reference checks.
  const allNames = new Set(mdFiles.map((f) => basename(f, ".md")));

  for (const filename of mdFiles) {
    findings.push(...(await lintOne(dir, filename, allNames)));
  }

  return { findings, noteCount: mdFiles.length };
}

export function formatKnowledgeFindings(result: KnowledgeLintResult): string {
  return formatLintFindings(result.findings, result.noteCount, {
    noun: "note",
    getItem: (f) => f.note,
  });
}

export function hasKnowledgeErrors(result: KnowledgeLintResult): boolean {
  return hasLintErrors(result.findings);
}
