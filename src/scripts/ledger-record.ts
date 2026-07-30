#!/usr/bin/env bun
// PostToolBatch hook — record which files a tool batch read and changed into
// the session ledger. Silent: no stdout, no decision, pure side effect.
//
// PostToolBatch (not PostToolUse) is the right seam: it fires exactly once per
// batch of parallel tool calls, so a turn that reads six files appends six
// entries from one process instead of racing six concurrent appenders on the
// same file.
//
// The payload's `tool_calls[].tool_response` carries the full body of every
// file read. It is never touched here — see src/lib/session-ledger.ts for the
// metadata-only contract.

import { readHookInput, runHook } from "../lib/hook-runtime.ts";
import { isoNow } from "../lib/platform.ts";
import { appendEntries, entryForToolCall, type LedgerEntry } from "../lib/session-ledger.ts";

// A type alias, not an interface: readHookInput's `T extends Record<string,
// unknown>` constraint is satisfied by object-literal types (implicit index
// signature) but not by interfaces.
type PostToolBatchInput = {
  session_id: string;
  cwd: string;
  tool_calls: { tool_name?: unknown; tool_input?: unknown }[];
};

await runHook(async () => {
  const input = await readHookInput<PostToolBatchInput>({ session_id: "CLAUDE_SESSION_ID" });
  const calls = Array.isArray(input.tool_calls) ? input.tool_calls : [];
  if (calls.length === 0) return;

  const now = isoNow();
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const entries: LedgerEntry[] = [];
  for (const call of calls) {
    if (typeof call !== "object" || call === null) continue;
    const entry = entryForToolCall(call, now, cwd);
    if (entry) entries.push(entry);
  }
  await appendEntries(input.session_id, entries);
});
