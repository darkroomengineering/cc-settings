#!/usr/bin/env bun
// Stop hook: if the session touched > 5 files, nudge the user to capture
// learnings. Extracted from inline `bash -c '…'` — Phase 6.2.

export {};

const proc = Bun.spawn(["git", "diff", "--stat"], { stdout: "pipe", stderr: "ignore" });
const out = await new Response(proc.stdout).text();
await proc.exited;

// Last line of `git diff --stat` looks like "N files changed, M insertions(+)".
const lastLine = out.trimEnd().split("\n").pop() ?? "";
const match = lastLine.match(/(\d+)\s+files?\s+changed/);
const count = match ? Number(match[1]) : 0;

if (count > 5) {
  console.log(
    `[Hook] Session had significant changes (${count} files) - consider storing learnings:`,
  );
  console.log("  bun src/scripts/learning.ts store <category> <learning> [context]");
  console.log("  Categories: bug | pattern | gotcha | tool | perf | config | arch | test");
}
