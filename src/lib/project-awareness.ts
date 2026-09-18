// Surface local project standards + git context at session start (and on cwd change).
// Keep output tight — this runs on every SessionStart / CwdChanged and occupies Claude's context.

import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { runGit } from "./git.ts";

async function gitRoot(cwd: string): Promise<string> {
  return runGit(["rev-parse", "--show-toplevel"], { cwd });
}

async function countMd(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir);
    return entries.filter((e) => e.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

async function localClaudeSubdirs(gitDir: string): Promise<string[]> {
  const base = join(gitDir, ".claude");
  const found: string[] = [];
  for (const sub of ["agents", "skills", "hooks", "commands", "rules"]) {
    try {
      const st = await stat(join(base, sub));
      if (st.isDirectory()) found.push(sub);
    } catch {
      // absent — skip
    }
  }
  return found;
}

export async function projectAwareness(cwd: string): Promise<string[]> {
  const root = await gitRoot(cwd);
  if (!root) return [];

  const [branch, log, rulesCount, localSubdirs] = await Promise.all([
    runGit(["branch", "--show-current"], { cwd: root }),
    runGit(["log", "--oneline", "-3"], { cwd: root }),
    countMd(join(root, "rules")),
    localClaudeSubdirs(root),
  ]);

  const hasAgentsMd =
    existsSync(join(root, "AGENTS.md")) || existsSync(join(root, ".claude", "AGENTS.md"));
  // Any of these three makes Claude Code (2.1.277+) skip the project's
  // AGENTS.md; ~/.claude/CLAUDE.md and .claude/rules/ do not count.
  const claudeMdFiles = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"].filter((rel) =>
    existsSync(join(root, rel)),
  );

  const standards: string[] = [];
  standards.push(`AGENTS.md ${hasAgentsMd ? "✓" : "✗"}`);
  standards.push(`CLAUDE.md ${claudeMdFiles.length > 0 ? "✓" : "✗"}`);
  if (rulesCount > 0) standards.push(`rules/ (${rulesCount})`);
  if (localSubdirs.length > 0) standards.push(`.claude/{${localSubdirs.join(",")}}`);

  const lines: string[] = [];
  lines.push("");
  lines.push("PROJECT CONTEXT");
  lines.push("------------------------------------");
  if (branch) lines.push(`Branch: ${branch}`);
  lines.push(`Standards: ${standards.join(" · ")}`);
  if (claudeMdFiles.length > 0) {
    lines.push(
      `${claudeMdFiles.join(", ")} keeps Claude Code from reading this project's AGENTS.md ` +
        `(2.1.277+ reads it natively only when no CLAUDE.md exists). ` +
        `Run /cc migrate to ${hasAgentsMd ? "merge it into" : "rename it to"} AGENTS.md, ` +
        "which Codex and Cursor read too.",
    );
  }
  if (log) {
    lines.push("Recent commits:");
    for (const l of log.split("\n")) lines.push(`  ${l}`);
  }
  lines.push("------------------------------------");
  return lines;
}
