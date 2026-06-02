#!/usr/bin/env bun
// PostCompact hook — remind Claude to recover context after compaction.
// Port of scripts/post-compact.sh. Pure stdout; no state writes.

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

console.log("[PostCompact] Context was compacted. Recovery steps:");
console.log("  1. Re-read your active task plan (check plans/ directory)");
console.log("  2. Re-read any files you were actively editing");
console.log("  3. Check TaskList for current progress");
console.log("  4. Resume from where you left off");

const handoffDir = join(homedir(), ".claude", "handoffs");
try {
  const entries = await readdir(handoffDir);
  // Skip symlink aliases (latest.md etc.) so we return the canonical handoff
  // file — matches `ls -t *.md | head -1` in the bash version.
  const mdFiles = entries.filter((e) => e.endsWith(".md") && !e.startsWith("latest"));
  if (mdFiles.length > 0) {
    const withStat = await Promise.all(
      mdFiles.map(async (name) => {
        const full = join(handoffDir, name);
        const st = await stat(full);
        return { full, mtime: st.mtimeMs };
      }),
    );
    // Newest first; on tie, reverse-alpha to match `ls -t`.
    withStat.sort((a, b) => b.mtime - a.mtime || b.full.localeCompare(a.full));
    const latest = withStat[0];
    if (latest) console.log(`  5. Handoff saved: ${latest.full}`);
  }
} catch {
  // Directory missing or unreadable — parity with bash: silently skip.
}
