#!/usr/bin/env bun
// PreToolUse hook on `git commit*`: run tsc --noEmit, block commit on errors.
// Extracted from inline `bash -c '…'` in settings.json — Phase 6.2.
//
// Contract: exit 0 allows, non-zero blocks (Claude Code surfaces stderr).

import { existsSync } from "node:fs";

// Self-gate: only run on `git commit` Bash invocations. The group-level
// `if: "Bash(git commit*)"` filter in settings.json isn't reliably applied by
// Claude Code 2.1.118 (fires on every tool call including ToolSearch), so we
// re-check here. Matches the pattern used by safety-net.ts and
// check-docs-before-install.ts.
const cmd = process.env.TOOL_INPUT_command ?? "";
if (!/(^|[;&|\s])git\s+commit\b/.test(cmd)) process.exit(0);

if (!existsSync("tsconfig.json")) {
  // Not a TS project — allow.
  process.exit(0);
}

const proc = Bun.spawn(["bunx", "tsc", "--noEmit", "--pretty"], {
  stdout: "pipe",
  stderr: "pipe",
});
const [stdout, stderr, code] = (await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
])) as [string, string, number];

const combined = stdout + stderr;
const hasErrors = code !== 0 || /error TS/.test(combined);
if (hasErrors) {
  console.error("[Pre-commit Hook] TypeScript errors found - fix before committing");
  // Tail the last 20 lines for the user to act on.
  const lines = combined.trimEnd().split("\n").slice(-20);
  for (const line of lines) console.error(line);
  process.exit(1);
}
process.exit(0);
