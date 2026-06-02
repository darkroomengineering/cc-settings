#!/usr/bin/env bun
// PostToolUseFailure hook — log tool failures and warn on repeated failures per session.
// Port of scripts/post-failure.sh.
//
// Fail-open: always exits 0. Reads TOOL_NAME / TOOL_ERROR from env.
// Per-session failure tally lives at ~/.claude/tmp/tool-failure-counts.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CLAUDE_DIR = join(homedir(), ".claude");
const LOG_DIR = join(CLAUDE_DIR, "logs");
const LOG_FILE = join(LOG_DIR, "tool-failures.log");
const TMP_DIR = join(CLAUDE_DIR, "tmp");
const SESSION_FILE = join(TMP_DIR, "tool-failure-counts");

await mkdir(LOG_DIR, { recursive: true }).catch(() => {});
await mkdir(TMP_DIR, { recursive: true }).catch(() => {});

const toolName = process.env.TOOL_NAME ?? "unknown";
let toolError = process.env.TOOL_ERROR ?? "";
const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

if (toolError.length > 200) toolError = `${toolError.slice(0, 200)}...`;

// JSON line — Bun/JSON.stringify escapes quotes + newlines safely, same
// intent as the bash `jq -n --arg ... '{...}'` path.
const logLine = `${JSON.stringify({
  timestamp,
  tool: toolName,
  error: toolError.slice(0, 200),
})}\n`;
await appendFile(LOG_FILE, logLine).catch(() => {});

// Per-session tally: session file has one line per failure, tool name only.
let currentCount = 0;
try {
  const contents = await readFile(SESSION_FILE, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    if (line === toolName) currentCount++;
  }
} catch {
  // No session file yet — first failure this session.
}

await appendFile(SESSION_FILE, `${toolName}\n`).catch(() => {});

const newCount = currentCount + 1;
if (newCount >= 3) {
  console.log("");
  console.log(
    `[Hook] Tool ${toolName} has failed ${newCount} times this session. Consider a different approach.`,
  );
}
