#!/usr/bin/env bun
// PostToolUse hook for mcp__tldr tools — increment session stats counter.
// Port of scripts/track-tldr.sh. Receives the tool name as argv[0].
//
// State file: ~/.claude/tldr-session-stats.json (atomic write via tmp + rename).

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { atomicWriteString } from "../lib/mcp.ts";

const STATS_FILE = join(homedir(), ".claude", "tldr-session-stats.json");
const toolName = process.argv[2] ?? "unknown";

// Same savings table as scripts/track-tldr.sh.
function savingsFor(name: string): number {
  if (name.includes("context")) return 500;
  if (name.includes("semantic")) return 1000;
  if (name.includes("impact") || name.includes("slice")) return 800;
  if (name.includes("arch")) return 600;
  return 300;
}

type Stats = { calls: number; tokens_saved: number };

async function loadStats(): Promise<Stats> {
  const f = Bun.file(STATS_FILE);
  if (!(await f.exists())) return { calls: 0, tokens_saved: 0 };
  try {
    const raw = (await f.json()) as Partial<Stats>;
    return {
      calls: typeof raw.calls === "number" ? raw.calls : 0,
      tokens_saved: typeof raw.tokens_saved === "number" ? raw.tokens_saved : 0,
    };
  } catch {
    return { calls: 0, tokens_saved: 0 };
  }
}

const current = await loadStats();
const next: Stats = {
  calls: current.calls + 1,
  tokens_saved: current.tokens_saved + savingsFor(toolName),
};

await mkdir(dirname(STATS_FILE), { recursive: true });
await atomicWriteString(STATS_FILE, `${JSON.stringify(next)}\n`);
