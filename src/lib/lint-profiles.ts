// Profile frontmatter linter. Validates every top-level profiles/<name>.md
// file against ProfileFrontmatter. Mirrors lint-agents.ts in shape — flat
// directory of .md files, shared lintFrontmatterCore scaffolding.
//
// ProfileSeverity:
//   error   — blocks (CI fails, lint:profiles exits non-zero)
//   warning — surfaced but non-blocking
//
// Unlike agents/, ProfileFrontmatter has no isolation/memory fields, so there
// is no narrow-schema-enum carve-out here today. If that changes, mirror the
// pattern from lint-agents.ts.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProfileFrontmatter } from "../schemas/profile.ts";
import { extractFrontmatterBlock } from "./frontmatter.ts";
import { lintFrontmatterCore } from "./lint-frontmatter.ts";

export type ProfileSeverity = "error" | "warning";

export interface ProfileFinding {
  profile: string;
  severity: ProfileSeverity;
  rule: string;
  message: string;
}

export interface ProfileLintResult {
  findings: ProfileFinding[];
  profileCount: number;
}

async function lintOne(profilesDir: string, filename: string): Promise<ProfileFinding[]> {
  const findings: ProfileFinding[] = [];
  const name = filename.replace(/\.md$/, "");
  const filePath = join(profilesDir, filename);

  const text = await readFile(filePath, "utf8");

  // Raw-text scan: catches angle brackets in any field, including passthrough
  // ones the schema doesn't validate the value of. Must run before
  // frontmatter parsing so we scan the raw block. Mirrors lint-skills.ts.
  const block = extractFrontmatterBlock(text) ?? "";
  if (/[<>]/.test(block)) {
    findings.push({
      profile: name,
      severity: "error",
      rule: "no-angle-brackets",
      message:
        "frontmatter contains `<` or `>` — security restriction, frontmatter is injected into the system prompt",
    });
  }

  // Shared scaffolding: frontmatter-missing + yaml-parse errors.
  const baseFindings = await lintFrontmatterCore(text, (parsed) => {
    const domainFindings: Array<{ severity: ProfileSeverity; rule: string; message: string }> = [];

    const result = ProfileFrontmatter.safeParse(parsed);
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
        rule: "name-file-mismatch",
        message: `frontmatter name "${fm.name}" does not match filename "${name}"`,
      });
    }

    return domainFindings;
  });

  for (const f of baseFindings) {
    findings.push({ profile: name, severity: f.severity, rule: f.rule, message: f.message });
  }

  return findings;
}

export async function lintProfilesDir(profilesDir: string): Promise<ProfileLintResult> {
  if (!existsSync(profilesDir)) {
    return { findings: [], profileCount: 0 };
  }

  const entries = await readdir(profilesDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "README.md")
    .map((e) => e.name);

  const findings: ProfileFinding[] = [];
  for (const filename of files) {
    findings.push(...(await lintOne(profilesDir, filename)));
  }

  return { findings, profileCount: files.length };
}

export function formatProfileFindings(result: ProfileLintResult): string {
  const errors = result.findings.filter((f) => f.severity === "error");
  const warnings = result.findings.filter((f) => f.severity === "warning");

  const lines: string[] = [];
  lines.push(`Linted ${result.profileCount} profile(s).`);

  for (const f of result.findings) {
    const icon = f.severity === "error" ? "✖" : "⚠";
    lines.push(`  ${icon} ${f.profile} [${f.rule}] ${f.message}`);
  }

  lines.push("");
  lines.push(`${errors.length} error(s), ${warnings.length} warning(s).`);
  return lines.join("\n");
}

export function hasProfileErrors(result: ProfileLintResult): boolean {
  return result.findings.some((f) => f.severity === "error");
}
