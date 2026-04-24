// Surface local project standards + git context at session start (and on cwd change).
// Keep output tight — this runs on every SessionStart / CwdChanged and occupies Claude's context.

import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

async function run(cmd: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return proc.exitCode === 0 ? out.trim() : "";
}

async function gitRoot(cwd: string): Promise<string> {
  return run(["git", "rev-parse", "--show-toplevel"], cwd);
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
    run(["git", "branch", "--show-current"], root),
    run(["git", "log", "--oneline", "-3"], root),
    countMd(join(root, "rules")),
    localClaudeSubdirs(root),
  ]);

  const standards: string[] = [];
  standards.push(`AGENTS.md ${existsSync(join(root, "AGENTS.md")) ? "✓" : "✗"}`);
  standards.push(`CLAUDE.md ${existsSync(join(root, "CLAUDE.md")) ? "✓" : "✗"}`);
  if (rulesCount > 0) standards.push(`rules/ (${rulesCount})`);
  if (localSubdirs.length > 0) standards.push(`.claude/{${localSubdirs.join(",")}}`);

  const lines: string[] = [];
  lines.push("");
  lines.push("PROJECT CONTEXT");
  lines.push("------------------------------------");
  if (branch) lines.push(`Branch: ${branch}`);
  lines.push(`Standards: ${standards.join(" · ")}`);
  if (log) {
    lines.push("Recent commits:");
    for (const l of log.split("\n")) lines.push(`  ${l}`);
  }
  lines.push("------------------------------------");
  return lines;
}
