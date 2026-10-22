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
        message:
          e.line != null
            ? `${e.message} (line ${e.line}${e.col != null ? `, col ${e.col}` : ""})`
            : e.message,
      });
    }
    return findings;
  }

  findings.push(...(await onParsed(parsed)));
  return findings;
}

/**
 * Generic lint-report formatter shared by every lint-*.ts module. Filters
 * errors/warnings, prints a "Linted N <noun>(s)." header, one line per
 * finding ("  {icon} {item} [{rule}] {message}"), then a summary line
 * ("N error(s), N warning(s)."). Callers supply the noun (e.g. "agent",
 * "skill") and how to extract the display item (e.g. `f.agent`, `f.skill`)
 * from a domain-specific finding.
 */
export function formatLintFindings<F extends BaseFinding>(
  findings: F[],
  lintedCount: number,
  opts: { noun: string; getItem: (f: F) => string },
): string {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  const lines: string[] = [];
  lines.push(`Linted ${lintedCount} ${opts.noun}(s).`);

  for (const f of findings) {
    const icon = f.severity === "error" ? "✖" : "⚠";
    lines.push(`  ${icon} ${opts.getItem(f)} [${f.rule}] ${f.message}`);
  }

  lines.push("");
  lines.push(`${errors.length} error(s), ${warnings.length} warning(s).`);
  return lines.join("\n");
}

/** For consumers that just want to gate CI on errors only. */
export function hasLintErrors(findings: { severity: LintSeverity }[]): boolean {
  return findings.some((f) => f.severity === "error");
}
