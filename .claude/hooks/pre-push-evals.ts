#!/usr/bin/env bun
// Repo-local PreToolUse hook for cc-settings (wired in .claude/settings.json,
// never installed). On `git push`, run the `claude plugin eval` cases for the
// skills changed since the upstream branch (src/scripts/eval-changed.ts) and
// block the push when a changed skill has no case or a case fails. Pushes that
// touch no skill pass through with no model calls.
//
// Exit 0 allows. Exit 2 blocks with the reason on stderr. Infrastructure
// errors fail open, same as pre-commit-invariants.ts.

import { readHookInput } from "../../src/lib/hook-runtime.ts";

// Claude Code sends the PreToolUse payload on stdin; the env vars are fallbacks.
async function readCommand(): Promise<string> {
  const input = await readHookInput<{ tool_input?: { command?: unknown } }>();
  const fromStdin = input.tool_input?.command;
  if (typeof fromStdin === "string") return fromStdin;
  const env = process.env.TOOL_INPUT_command;
  if (env) return env;
  try {
    const parsed = JSON.parse(process.env.TOOL_INPUT ?? "{}") as { command?: string };
    return parsed.command ?? "";
  } catch {
    return "";
  }
}

const command = await readCommand();
if (!/\bgit\s+(?:-C\s+\S+\s+)?push\b/.test(command)) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
try {
  const proc = Bun.spawnSync({
    cmd: ["bun", "src/scripts/eval-changed.ts"],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 840_000,
  });
  const out = new TextDecoder().decode(proc.stderr).trim();
  if (proc.exitCode === 0) {
    if (out) console.error(out);
    process.exit(0);
  }
  if (proc.exitCode !== 1) process.exit(0);
  console.error(`[Harness] Skill evals failed; push blocked.\n${out}\nRun: bun src/scripts/eval-changed.ts`);
  process.exit(2);
} catch {
  process.exit(0);
}
