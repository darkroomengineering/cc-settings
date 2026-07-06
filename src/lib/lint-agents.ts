// Agent frontmatter linter. Validates every top-level agents/<name>.md file
// against AgentFrontmatter. Mirrors lint-skills.ts / lint-knowledge.ts in
// shape (shared lintFrontmatterCore scaffolding), but agents/ is a flat
// directory of .md files rather than <name>/SKILL.md subdirectories.
//
// AgentSeverity:
//   error   — blocks (CI fails, lint:agents exits non-zero)
//   warning — surfaced but non-blocking
//
// Known narrow-schema gap (see open issue #82/#104): AgentIsolation only
// accepts "worktree" and AgentMemory only accepts "project", but
// `isolation: remote` and `memory: user` are real, discussed concepts that
// just haven't landed in the schema yet. Rather than hard-fail an agent for
// using one of those two specific values, this linter downgrades exactly
// those to a warning and validates the rest of the frontmatter normally.
// Any other schema violation (typo'd effort, bad permissionMode, etc.)
// remains a hard error.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentFrontmatter } from "../schemas/agent.ts";
import { lintFrontmatterCore } from "./lint-frontmatter.ts";

export type AgentSeverity = "error" | "warning";

export interface AgentFinding {
  agent: string;
  severity: AgentSeverity;
  rule: string;
  message: string;
}

export interface AgentLintResult {
  findings: AgentFinding[];
  agentCount: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// field -> value considered a known-narrow-schema gap (warn, don't error).
// See file header note and issue #82/#104.
const NARROW_ENUM_WARNINGS: Record<string, unknown> = {
  isolation: "remote",
  memory: "user",
};

async function lintOne(agentsDir: string, filename: string): Promise<AgentFinding[]> {
  const findings: AgentFinding[] = [];
  const name = filename.replace(/\.md$/, "");
  const filePath = join(agentsDir, filename);

  const text = await readFile(filePath, "utf8");

  // Shared scaffolding: frontmatter-missing + yaml-parse errors.
  const baseFindings = await lintFrontmatterCore(text, (parsed) => {
    const domainFindings: Array<{ severity: AgentSeverity; rule: string; message: string }> = [];

    if (!isRecord(parsed)) {
      domainFindings.push({
        severity: "error",
        rule: "schema",
        message: "frontmatter did not parse to an object",
      });
      return domainFindings;
    }

    // Downgrade known-narrow-schema enum gaps to warnings, then drop the
    // field before schema validation — both isolation and memory are
    // optional in AgentFrontmatter, so omitting is equivalent to a valid
    // placeholder and the rest of validation still runs normally.
    const adjusted: Record<string, unknown> = { ...parsed };
    for (const [field, narrowValue] of Object.entries(NARROW_ENUM_WARNINGS)) {
      if (adjusted[field] === narrowValue) {
        domainFindings.push({
          severity: "warning",
          rule: "narrow-schema-enum",
          message: `${field}: "${narrowValue}" is not yet in the schema (see open issue #82/#104) — accepted here as a warning, not an error`,
        });
        delete adjusted[field];
      }
    }

    const result = AgentFrontmatter.safeParse(adjusted);
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
    findings.push({ agent: name, severity: f.severity, rule: f.rule, message: f.message });
  }

  return findings;
}

export async function lintAgentsDir(agentsDir: string): Promise<AgentLintResult> {
  if (!existsSync(agentsDir)) {
    return { findings: [], agentCount: 0 };
  }

  const entries = await readdir(agentsDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "README.md")
    .map((e) => e.name);

  const findings: AgentFinding[] = [];
  for (const filename of files) {
    findings.push(...(await lintOne(agentsDir, filename)));
  }

  return { findings, agentCount: files.length };
}

export function formatAgentFindings(result: AgentLintResult): string {
  const errors = result.findings.filter((f) => f.severity === "error");
  const warnings = result.findings.filter((f) => f.severity === "warning");

  const lines: string[] = [];
  lines.push(`Linted ${result.agentCount} agent(s).`);

  for (const f of result.findings) {
    const icon = f.severity === "error" ? "✖" : "⚠";
    lines.push(`  ${icon} ${f.agent} [${f.rule}] ${f.message}`);
  }

  lines.push("");
  lines.push(`${errors.length} error(s), ${warnings.length} warning(s).`);
  return lines.join("\n");
}

export function hasAgentErrors(result: AgentLintResult): boolean {
  return result.findings.some((f) => f.severity === "error");
}
