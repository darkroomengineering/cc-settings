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
import {
  computeSignatureKey,
  recordSignature,
  type SignatureMap,
  sanitizeSample,
} from "../lib/problem-signature.ts";
import { appendEntries, failureEntry, isSafeSessionId } from "../lib/session-ledger.ts";

const LOG_DIR = claudePath("logs");
const LOG_FILE = join(LOG_DIR, "tool-failures.log");

await mkdir(LOG_DIR, { recursive: true }).catch(() => {});

// Stdin is read ONCE, up front, and every field below comes from it — the
// PostToolUseFailure payload carries {tool_name, tool_input, tool_use_id,
// error, is_interrupt, duration_ms} alongside the common fields (verified
// against the 2.1.220 binary; the docs page omits this event's shape). The env
// vars remain as a fallback for older/wrapper invocations that set them.
const input = await readHookInput<{
  session_id: string;
  tool_name: string;
  error: string;
  cwd: string;
  tool_use_id: string;
}>({ session_id: "CLAUDE_SESSION_ID", tool_name: "TOOL_NAME", error: "TOOL_ERROR" });

const toolName = input.tool_name ?? process.env.TOOL_NAME ?? "unknown";
// Kept FULL (untruncated) so the signature hash below sees everything —
// two failures differing only after character 200 must not collapse into
// one signature just because the log/ledger sample gets bounded.
const fullError = input.error ?? process.env.TOOL_ERROR ?? "";
const timestamp = isoNow();

// Redact-then-bound, computed from the FULL (untruncated) error — never from
// the already-truncated `toolError` above. redactSecrets's patterns require a
// minimum trailing length after each prefix (e.g. `AKIA[A-Z0-9]{12,}`); slicing
// first can cut a credential short enough that the pattern no longer matches,
// leaking a partial token in whatever gets bounded next. Mirrors failureEntry's
// redact-then-bound order in session-ledger.ts. Bound (200 chars) matches the
// previous truncate-then-sanitize bound so stored/logged sizes are unchanged.
// Used for BOTH the log line below (Fix: that sink was writing raw error text)
// and the signature sample recorded further down.
const sanitizedError = sanitizeSample(fullError);
const boundedSample =
  sanitizedError.length > 200 ? `${sanitizedError.slice(0, 200)}...` : sanitizedError;

// JSON line — Bun/JSON.stringify escapes quotes + newlines safely, same
// intent as the bash `jq -n --arg ... '{...}'` path.
const logLine = `${JSON.stringify({
  timestamp,
  tool: toolName,
  error: boundedSample, // redacted + bounded to 200 chars above — never raw
})}\n`;
await appendFile(LOG_FILE, logLine).catch(() => {});

// The same failure, recorded as a session artifact so a handoff can name the
// exact tool and message rather than "something failed". failureEntry redacts
// then bounds internally, so it must receive the FULL error: handing it a
// pre-truncated string reintroduces the split-credential leak on this sink,
// which is what it used to do. Fail-open inside appendEntries.
await appendEntries(input.session_id, [
  failureEntry(toolName, fullError, timestamp, input.cwd, input.tool_use_id),
]);

// Session id is used verbatim in state-file NAMES below — validate before it
// ever reaches a filename, same convention session-ledger.ts's appendEntries/
// readDigest already gate on. session_id comes from the trusted CLI payload
// today (not attacker-reachable), but this keeps the convention consistent
// rather than leaving this one call site as the odd one out.
const sessionId = isSafeSessionId(input.session_id) ? input.session_id : "unknown";

// Per-session tally: counts keyed by tool name, file keyed by session id.
const STATE_FILE = `tool-failure-counts-${sessionId}`;
const counts = await readState<Record<string, number>>(STATE_FILE, {});
const currentCount = counts[toolName] ?? 0;
counts[toolName] = currentCount + 1;
await writeState(STATE_FILE, counts).catch(() => {});

// Signature-keyed tally: same {tool, normalized error} collapses to one
// bucket, so "Bash failed 3 times" for three unrelated commands doesn't read
// the same as one command failing three times the same way. Read by
// escalate-model.ts (UserPromptSubmit) to suggest a scoped Fable subagent
// pass on genuinely repeated failures — never spoken from here (see that
// hook's header for why counting and speaking are split across hooks).
const SIGNATURE_STATE_FILE = `problem-signatures-${sessionId}`;
const signatures = await readState<SignatureMap>(SIGNATURE_STATE_FILE, {});
const signatureKey = computeSignatureKey(toolName, fullError);
// The sample is redacted + flattened before it's ever written to disk (see
// boundedSample above) — it later gets pasted into model context by
// escalate.ts, so it gets the same treatment session-ledger.ts's failureEntry
// gives stored error text.
const updatedSignatures = recordSignature(signatures, signatureKey, toolName, boundedSample);
await writeState(SIGNATURE_STATE_FILE, updatedSignatures).catch(() => {});
