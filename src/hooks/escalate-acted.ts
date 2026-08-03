#!/usr/bin/env bun
// PostToolUse hook, matched on Agent only — the "acted" half of the
// fired-vs-acted telemetry pair for the model-escalation advisory (see
// escalate-model.ts). "Fired" measures that the advisory spoke; this measures
// whether it was ever followed by a subagent spawn. The Slack-thread thesis
// this whole feature responds to is "advisories get ignored" — the resulting
// act-rate decides whether a harder escalation is ever built.
//
// Matcher condition mirrors tool-cadence.ts's streak-reset check
// (`toolName === "Agent"`) exactly — that hook is the existing authority for
// "this tool call is a subagent spawn" in this environment, and this hook
// must not invent a different one. Wired in config/40-hooks.json with a
// `matcher: "Agent"` PostToolUse entry — never unmatched, since an unmatched
// PostToolUse hook runs on every tool call.
//
// Cheap-common path: no pending marker → return immediately. The
// overwhelming majority of Agent calls have no fired advisory to correlate
// against, so that path does no IO beyond the one state read.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  buildActedEvent,
  isWithinActedWindow,
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

async function main(): Promise<void> {
  const input = await readHookInput<Payload>({
    tool_name: "TOOL_NAME",
    session_id: "CLAUDE_SESSION_ID",
  });
  if (input.tool_name !== "Agent") return;

  const sessionId = isSafeSessionId(input.session_id) ? input.session_id : "unknown";
  const stateName = pendingStateName(sessionId);

  const raw = await readState<unknown>(stateName, null);
  const marker = parsePendingMarker(raw);
  if (!marker) return; // no pending advisory for this session — the common case

  const now = Date.now();
  // Clear the marker as soon as it's observed, whether this Agent call lands
  // inside or outside the acted window — a marker never survives past its
  // first observation.
  await writeState(stateName, {}).catch(() => {});

  // Stale: an Agent call an hour later is not a response to the advisory.
  if (!isWithinActedWindow(marker.firedAt, now)) return;

  // Extract the model override from the Agent tool's own input, if the
  // payload carries one — never guessed when absent.
  const model = typeof input.tool_input?.model === "string" ? input.tool_input.model : null;

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

await runHook(main);
