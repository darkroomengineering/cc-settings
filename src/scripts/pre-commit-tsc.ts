#!/usr/bin/env bun
// PreToolUse hook on `git commit*`: run tsc --noEmit, block commit on errors.
// Extracted from inline `bash -c '…'` in settings.json — Phase 6.2.
//
// Contract: exit 0 allows, non-zero blocks (Claude Code surfaces stderr).
//
// Fail-open on infrastructure errors only (bunx missing, OOM, etc.). A genuine
// `error TS<N>` from tsc still exits 1 and blocks the commit — that's the
// guard rail we want to preserve.

import { existsSync } from "node:fs";

async function main(): Promise<number> {
  // Self-gate: only run on `git commit` Bash invocations. The group-level
  // `if: "Bash(git commit*)"` filter in settings.json isn't reliably applied by
  // Claude Code 2.1.118 (fires on every tool call including ToolSearch), so we
  // re-check here. Matches the pattern used by safety-net.ts and
  // check-docs-before-install.ts.
  const cmd = process.env.TOOL_INPUT_command ?? "";
  if (!/(^|[;&|\s])git\s+commit\b/.test(cmd)) return 0;

  if (!existsSync("tsconfig.json")) {
    // Not a TS project — allow.
    return 0;
  }

  const proc = Bun.spawn(["bunx", "tsc", "--noEmit", "--pretty"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const combined = stdout + stderr;
  const hasErrors = code !== 0 || /error TS/.test(combined);
  if (hasErrors) {
    console.error("[Pre-commit Hook] TypeScript errors found - fix before committing");
    // Tail the last 20 lines for the user to act on.
    const lines = combined.trimEnd().split("\n").slice(-20);
    for (const line of lines) console.error(line);
    return 1;
  }
  return 0;
}

let exitCode = 0;
try {
  exitCode = await main();
} catch {
  // Infrastructure failure (bunx missing, spawn crashed) — fail-open, don't
  // block the commit on a hook bug. Genuine TS errors return 1 from main()
  // and bypass this catch.
  exitCode = 0;
}
process.exit(exitCode);
