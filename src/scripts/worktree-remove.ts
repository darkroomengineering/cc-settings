#!/usr/bin/env bun
// WorktreeRemove hook — log worktree removal events to ~/.claude/logs/worktree.log.
// PURE OBSERVABILITY: async, fail-open, always exits 0.

import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { runHook } from "../lib/hook-runtime.ts";

const logPath = join(homedir(), ".claude", "logs", "worktree.log");

async function main(): Promise<void> {
  const raw = await Bun.stdin.text().catch(() => "");
  let path = "";
  try {
    const payload = JSON.parse(raw) as { path?: string; worktree_path?: string };
    path = payload.path ?? payload.worktree_path ?? "";
  } catch {
    // fall through — still log with unknown path
  }

  const ts = new Date().toISOString();
  const line = `[${ts}] WorktreeRemove: ${path || "(unknown path)"}\n`;

  await mkdir(dirname(logPath), { recursive: true }).catch(() => {});
  await appendFile(logPath, line).catch(() => {});
}

await runHook(main);
