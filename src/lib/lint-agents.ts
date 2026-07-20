// Agent frontmatter linter. Validates every top-level agents/<name>.md file
// against AgentFrontmatter. Mirrors lint-skills.ts / lint-knowledge.ts in
// shape (shared lintFrontmatterCore scaffolding), but agents/ is a flat
// directory of .md files rather than <name>/SKILL.md subdirectories.
//
// AgentSeverity:
//   error   — blocks (CI fails, lint:agents exits non-zero)
//   warning — surfaced but non-blocking
//
// Historical note (issue #82/#104, resolved): AgentIsolation and AgentMemory
// used to only accept "worktree" and "project" respectively, even though
// "remote" isolation and "user"/"local" memory scopes were real, documented
// values. This linter used to carry a `narrow-schema-enum` carve-out that
// downgraded those two specific values to warnings instead of hard errors.
// Now that AgentIsolation/AgentMemory are widened in src/schemas/agent.ts to
// accept all of those values, the carve-out is gone — they're simply valid
// and pass AgentFrontmatter.safeParse like every other field.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentFrontmatter } from "../schemas/agent.ts";
import { extractFrontmatterBlock } from "./frontmatter.ts";
import {
  formatLintFindings,
  hasLintErrors,
  type LintSeverity,
  lintFrontmatterCore,
} from "./lint-frontmatter.ts";

export type AgentSeverity = LintSeverity;

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

async function lintOne(agentsDir: string, filename: string): Promise<AgentFinding[]> {
  const findings: AgentFinding[] = [];
  const name = filename.replace(/\.md$/, "");
  const filePath = join(agentsDir, filename);

  const text = await readFile(filePath, "utf8");

  // Raw-text scan: catches angle brackets in any field, including passthrough
  // ones the schema doesn't validate the value of. Must run before
  // frontmatter parsing so we scan the raw block. Mirrors lint-skills.ts.
  const block = extractFrontmatterBlock(text) ?? "";
  if (/[<>]/.test(block)) {
    findings.push({
      agent: name,
      severity: "error",
      rule: "no-angle-brackets",
      message:
        "frontmatter contains `<` or `>` — security restriction, frontmatter is injected into the system prompt",
    });
  }

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

    const result = AgentFrontmatter.safeParse(parsed);
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
  return formatLintFindings(result.findings, result.agentCount, {
    noun: "agent",
    getItem: (f) => f.agent,
  });
}

export function hasAgentErrors(result: AgentLintResult): boolean {
  return hasLintErrors(result.findings);
}
