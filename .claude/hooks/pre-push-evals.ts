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
import { gatedCheckout, gitTargets } from "./git-target.ts";

// Claude Code sends the PreToolUse payload on stdin; the env vars are fallbacks.
async function readInput(): Promise<{ command: string; cwd: string }> {
  const input = await readHookInput<{ cwd?: unknown; tool_input?: { command?: unknown } }>();
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  return { command: readCommand(input.tool_input?.command), cwd };
}

function readCommand(fromStdin: unknown): string {
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

// Parse the shell so only a real push runs the evals: the words inside a quoted
// grep pattern or commit message must not spend eval money, and env prefixes
// (`GIT_SSH_COMMAND=... git push`, `env git push`) must not skip the gate.
export function isPush(cmd: string): boolean {
  return gitTargets(cmd, "push", process.cwd()).length > 0;
}

if (import.meta.main) {
  const { command, cwd } = await readInput();
  const targets = gitTargets(command, "push", cwd);
  if (targets.length === 0) process.exit(0);
  // A push to another repository (Programa, a client repo) runs no evals.
  const root = gatedCheckout(targets, process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  if (root === null) process.exit(0);
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
}
