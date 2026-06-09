#!/usr/bin/env bun
// Stop hook: if the working tree has > 5 modified files (per `git diff --stat`),
// nudge the user to capture learnings. Extracted from inline `bash -c '…'` — Phase 6.2.
//
// Note: this measures the CURRENT working tree, not what the session itself
// touched — files dirty before the session started count toward the total, and
// work already committed during the session is invisible to it.
//
// Fail-open: git not on PATH, not in a repo, or any spawn failure must not
// break the Stop hook (which would interrupt the user's natural turn end).

import { runGit } from "../lib/git.ts";

try {
  const out = await runGit(["diff", "--stat"]);

  // Last line of `git diff --stat` looks like "N files changed, M insertions(+)".
  const lastLine = out.split("\n").pop() ?? "";
  const match = lastLine.match(/(\d+)\s+files?\s+changed/);
  const count = match ? Number(match[1]) : 0;

  if (count > 5) {
    console.log(`[Hook] Working tree has ${count} modified files - consider storing learnings:`);
    console.log("  Say 'remember this' and Claude will save to ~/.claude/projects/<hash>/memory/");
  }
} catch {
  // silent — learnings nudge is best-effort
}
