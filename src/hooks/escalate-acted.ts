#!/usr/bin/env bun
// PostToolUse hook, matched on Agent only — the "acted" half of the
// fired-vs-acted telemetry pair for BOTH advisories that currently emit one:
// the model-escalation advisory (escalate-model.ts) and the delegation
// advisory (delegation-detector.ts). "Fired" measures that an advisory
// spoke; this measures whether it was ever followed by a subagent spawn. The
// Slack-thread thesis this whole feature responds to is "advisories get
// ignored" — the resulting act-rate decides whether a harder escalation is
// ever built.
//
// Wired in config/40-hooks.json with a
// `matcher: "Agent"` PostToolUse entry — never unmatched, since an unmatched
// PostToolUse hook runs on every tool call.
//
// The two advisories' pending markers are independent: one Agent call can
// legitimately satisfy BOTH at once (e.g. the call is both a delegation and
// the escalation response), so each is checked and recorded on its own,
// never short-circuiting the other.
//
// Cheap-common path: no pending marker → return immediately. The
// overwhelming majority of Agent calls have no fired advisory to correlate
// against, so that path does no IO beyond the state reads.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  buildActedEvent,
  buildDelegationActedEvent,
  DELEGATION_ACTED_WINDOW_MS,
  delegationPendingStateName,
  isWithinActedWindow,
  parseDelegationPendingMarker,
  parsePendingMarker,
  pendingStateName,
  TELEMETRY_LOG,
  toJsonLine,
} from "../lib/escalate-telemetry.ts";
import { readHookInput, readState, runHook, writeState } from "../lib/hook-runtime.ts";
import { isoNow } from "../lib/platform.ts";
import { isSafeSessionId } from "../lib/session-ledger.ts";

type Payload = {
  tool_name: string;
  tool_input?: { model?: string };
  session_id: string;
};

/** The escalate advisory's acted half — unchanged logic, only extracted into
 *  its own function so it can run alongside recordDelegationActed without
 *  either short-circuiting the other. */
async function recordEscalateActed(
  sessionId: string,
  model: string | null,
  now: number,
): Promise<void> {
  const stateName = pendingStateName(sessionId);

  const raw = await readState<unknown>(stateName, null);
  const marker = parsePendingMarker(raw);
  if (!marker) return; // no pending escalate advisory for this session — the common case

  // Clear the marker as soon as it's observed, whether this Agent call lands
  // inside or outside the acted window — a marker never survives past its
  // first observation.
  await writeState(stateName, {}).catch(() => {});

  // Stale: an Agent call an hour later is not a response to the advisory.
  if (!isWithinActedWindow(marker.firedAt, now)) return;

  // latencyMs is fire→completion, not fire→spawn: PostToolUse fires when the
  // Agent tool call COMPLETES, not when it's spawned, so this window includes
  // the subagent's entire runtime. A promptly-spawned but long-running
  // subagent can blow past ACTED_WINDOW_MS on completion time alone and get
  // recorded as never-acted — an under-count, which is the accepted error
  // direction (see ACTED_WINDOW_MS's comment in escalate-telemetry.ts). Never
  // read this value as time-to-decision.
  const event = buildActedEvent({
    t: isoNow(),
    session: sessionId,
    sig: marker.sig,
    latencyMs: now - marker.firedAt,
    model,
  });
  await mkdir(dirname(TELEMETRY_LOG), { recursive: true }).catch(() => {});
  await appendFile(TELEMETRY_LOG, toJsonLine(event)).catch(() => {});
}

/** The delegation advisory's acted half. Same read/clear/append shape as
 *  recordEscalateActed above, but on the delegation marker and its own
 *  (much shorter) acted window — see DELEGATION_ACTED_WINDOW_MS's comment in
 *  escalate-telemetry.ts for why 10 minutes rather than escalate's 60: the
 *  delegation nudge says "delegate NOW", so staleness kicks in much sooner. */
async function recordDelegationActed(sessionId: string, now: number): Promise<void> {
  const stateName = delegationPendingStateName(sessionId);

  const raw = await readState<unknown>(stateName, null);
  const marker = parseDelegationPendingMarker(raw);
  if (!marker) return; // no pending delegation advisory for this session

  await writeState(stateName, {}).catch(() => {});

  if (!isWithinActedWindow(marker.firedAt, now, DELEGATION_ACTED_WINDOW_MS)) return;

  const event = buildDelegationActedEvent({
    t: isoNow(),
    session: sessionId,
    at: marker.at,
    latencyMs: now - marker.firedAt,
  });
  await mkdir(dirname(TELEMETRY_LOG), { recursive: true }).catch(() => {});
  await appendFile(TELEMETRY_LOG, toJsonLine(event)).catch(() => {});
}

async function main(): Promise<void> {
  const input = await readHookInput<Payload>({
    tool_name: "TOOL_NAME",
    session_id: "CLAUDE_SESSION_ID",
  });
  if (input.tool_name !== "Agent") return;

  const sessionId = isSafeSessionId(input.session_id) ? input.session_id : "unknown";
  // Extract the model override from the Agent tool's own input, if the
  // payload carries one — never guessed when absent. Only the escalate event
  // records a model; the delegation event has no such field.
  const model = typeof input.tool_input?.model === "string" ? input.tool_input.model : null;
  const now = Date.now();

  await recordEscalateActed(sessionId, model, now);
  await recordDelegationActed(sessionId, now);
}

await runHook(main);
