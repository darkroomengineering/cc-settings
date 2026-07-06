#!/usr/bin/env bun
// PostToolUseFailure hook — log tool failures and warn on repeated failures per session.
// Port of scripts/post-failure.sh.
//
// Fail-open: always exits 0. Reads TOOL_NAME / TOOL_ERROR from env, session_id
// from stdin JSON (falls back to CLAUDE_SESSION_ID env — same stdin+env
// pattern as session-title.ts). The tally file is keyed by session id so
// concurrent sessions never race on the same read-modify-write counter and a
// fresh SessionStart never wipes another session's live tally (#85).
// Per-session failure tally lives at ~/.claude/tmp/tool-failure-counts-<session>.

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readHookInput, readState, writeState } from "../lib/hook-runtime.ts";
import { claudePath, isoNow } from "../lib/platform.ts";

const LOG_DIR = claudePath("logs");
const LOG_FILE = join(LOG_DIR, "tool-failures.log");

await mkdir(LOG_DIR, { recursive: true }).catch(() => {});

const toolName = process.env.TOOL_NAME ?? "unknown";
let toolError = process.env.TOOL_ERROR ?? "";
const timestamp = isoNow();

if (toolError.length > 200) toolError = `${toolError.slice(0, 200)}...`;

// JSON line — Bun/JSON.stringify escapes quotes + newlines safely, same
// intent as the bash `jq -n --arg ... '{...}'` path.
const logLine = `${JSON.stringify({
  timestamp,
  tool: toolName,
  error: toolError, // already bounded to 200 chars + ellipsis above
})}\n`;
await appendFile(LOG_FILE, logLine).catch(() => {});

// Per-session tally: counts keyed by tool name, file keyed by session id.
const { session_id: sessionId = "unknown" } = await readHookInput<{ session_id: string }>({
  session_id: "CLAUDE_SESSION_ID",
});
const STATE_FILE = `tool-failure-counts-${sessionId}`;
const counts = await readState<Record<string, number>>(STATE_FILE, {});
const currentCount = counts[toolName] ?? 0;
counts[toolName] = currentCount + 1;
await writeState(STATE_FILE, counts).catch(() => {});

const newCount = currentCount + 1;
if (newCount >= 3) {
  console.log("");
  console.log(
    `[Hook] Tool ${toolName} has failed ${newCount} times this session. Consider a different approach.`,
  );
}
