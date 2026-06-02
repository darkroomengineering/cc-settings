#!/usr/bin/env bun
// SessionEnd hook companion — display + reset TLDR token-saving stats.
// Port of scripts/tldr-stats.sh.

import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const STATS_FILE = join(homedir(), ".claude", "tldr-session-stats.json");

const f = Bun.file(STATS_FILE);
if (!(await f.exists())) process.exit(0);

let calls = 0;
let tokens = 0;
try {
  const raw = (await f.json()) as { calls?: number; tokens_saved?: number };
  calls = typeof raw.calls === "number" ? raw.calls : 0;
  tokens = typeof raw.tokens_saved === "number" ? raw.tokens_saved : 0;
} catch {
  // Malformed file — same as bash `// 0` fallback.
}

if (calls > 0) {
  // Parity with the bash-drawn box. printf %-39s ensures consistent width.
  const pad = (s: string): string => s + " ".repeat(Math.max(0, 39 - s.length));
  console.log("");
  console.log("┌─────────────────────────────────────────┐");
  console.log("│ 📊 TLDR Session Stats                   │");
  console.log("├─────────────────────────────────────────┤");
  console.log(`│ ${pad(`Calls: ${calls}`)} │`);
  console.log(`│ ${pad(`Est. tokens saved: ~${tokens}`)} │`);
  console.log("└─────────────────────────────────────────┘");
}

// Reset for next session.
await unlink(STATS_FILE).catch(() => {});
