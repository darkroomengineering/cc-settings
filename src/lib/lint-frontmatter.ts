// Shared scaffolding for frontmatter-based linters.
//
// Handles the mechanical per-file boilerplate that both lint-skills and
// lint-knowledge duplicate:
//   1. Extract the `---`-delimited YAML block (report "frontmatter-missing").
//   2. Parse with strict YAML (report "yaml-parse" errors per error object).
//   3. Delegate to the caller's domain-specific logic via `onParsed`.
//
// The public types exposed here are intentionally minimal — callers map
// BaseFinding into their own domain-specific finding types (LintFinding,
// KnowledgeFinding) which carry a domain-specific item-name field.

import { extractFrontmatterBlock, parseFrontmatterStrict } from "./frontmatter.ts";

/** Severity shared across all linting domains. */
export type LintSeverity = "error" | "warning";

/** Minimal finding shape: severity + rule + message, without any item field. */
export interface BaseFinding {
  severity: LintSeverity;
  rule: string;
  message: string;
}

/**
 * Run the shared frontmatter scaffolding on a single file's text content.
 *
 * Returns an array of `BaseFinding`s for the scaffolding rules
 * (`frontmatter-missing`, `yaml-parse`). When those pass, calls `onParsed`
 * with the parsed YAML object so the caller can apply domain-specific rules
 * and append their own findings.
 *
 * @param text     Full file text (UTF-8).
 * @param onParsed Called with the successfully parsed YAML object. May be
 *                 sync or async. Return `[]` for no additional findings.
 */
export async function lintFrontmatterCore(
  text: string,
  onParsed: (data: unknown) => BaseFinding[] | Promise<BaseFinding[]>,
): Promise<BaseFinding[]> {
  const findings: BaseFinding[] = [];

  const block = extractFrontmatterBlock(text);
  if (!block) {
    findings.push({
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
        severity: "error",
        rule: "yaml-parse",
        message: `${e.code ?? "YAML"} at line ${e.line ?? "?"}, col ${e.col ?? "?"}: ${e.message}`,
      });
    }
    return findings;
  }

  findings.push(...(await onParsed(parsed)));
  return findings;
}
