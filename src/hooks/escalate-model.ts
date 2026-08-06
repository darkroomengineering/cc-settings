#!/usr/bin/env bun

// UserPromptSubmit hook — suggest escalating to a Fable 5 subagent when the
// same problem signature (tool + normalized error, see problem-signature.ts)
// has repeated CC_ESCALATE_THRESHOLD+ times this session. Advisory only: the
// session's own model cannot be switched by a hook, so this names the move
// (a Fable-model subagent scoped to the failing slice) rather than acting.
//
// Counting vs speaking is deliberately split across two hooks. post-failure.ts
// (PostToolUseFailure) writes the problem-signatures-<session> tally; whether
// that hook's stdout reaches the model at all is undocumented and unverified.
// emitAdditionalContext on UserPromptSubmit is known-honored (quota-steer.ts
// depends on it), and speaking here also lands the suggestion exactly when
// the user is about to send another "still broken" message.
//
// Quota-gated: silent at BOTH the elevated and critical quota bands, so this
// hook never contradicts quota-steer.ts — which at elevated already says to
// keep subagents on sonnet and reserve Opus/Fable turns for planning,
// synthesis, and gate decisions, and at critical says to avoid Opus/Fable
// subagents entirely. Recommending a Fable subagent here at either band is
// exactly the wrong move: 2x spend when quota is already tight. Fail-open:
// any error → silent success, never block the prompt.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  buildEscalateMessage,
  isFableSession,
  readEscalateState,
  shouldEscalate,
  type TopSignature,
  topUnannouncedSignature,
  withAnnouncement,
  writeEscalateState,
} from "../lib/escalate.ts";
import {
  buildFiredEvent,
  type EscalateVariant,
  pendingStateName,
  TELEMETRY_LOG,
  toJsonLine,
} from "../lib/escalate-telemetry.ts";
import { intEnv } from "../lib/hook-config.ts";
import {
  emitAdditionalContext,
  readHookInput,
  readState,
  runHook,
  writeState,
} from "../lib/hook-runtime.ts";
import { isoNow } from "../lib/platform.ts";
import type { SignatureMap } from "../lib/problem-signature.ts";
import {
  computeBand,
  type QuotaBand,
  readRateLimitsCache,
  resolveRateLimits,
} from "../lib/quota.ts";
import { isSafeSessionId } from "../lib/session-ledger.ts";
import { readSessionModel } from "../lib/session-model.ts";

/** Record that the advisory fired: one JSONL line to the cross-session
 *  telemetry log (signature key + tool name only — never the sample text,
 *  a hard privacy requirement), plus a per-session pending marker that
 *  escalate-acted.ts consumes to tell whether this fire was ever acted on.
 *  Fail-open at every IO step — telemetry must never be the reason the
 *  advisory itself fails to speak. */
async function recordFired(
  sessionId: string,
  top: TopSignature,
  sessionModel: string | null,
): Promise<void> {
  const variant: EscalateVariant = isFableSession(sessionModel) ? "fable-session" : "escalate";
  const event = buildFiredEvent({
    t: isoNow(),
    session: sessionId,
    sig: top.key,
    tool: top.entry.tool,
    count: top.entry.count,
    variant,
  });
  await mkdir(dirname(TELEMETRY_LOG), { recursive: true }).catch(() => {});
  await appendFile(TELEMETRY_LOG, toJsonLine(event)).catch(() => {});
  await writeState(pendingStateName(sessionId), { sig: top.key, firedAt: Date.now() }).catch(
    () => {},
  );
}

// Same env-override precedent as CC_PARALLELMAX_THRESHOLD (hook-config.ts) —
// default 3 matches post-failure.ts's existing "repeated failure" bar.
const THRESHOLD = intEnv("CC_ESCALATE_THRESHOLD", 3);

/** "unknown" when no session in the cache survives the staleness prune (same
 *  window quota-steer.ts uses, via resolveRateLimits) — treated as NOT
 *  elevated/critical, so a dead/never-populated cache fails open toward the
 *  suggestion rather than silence. Uses the max-of-fresh-sessions reading,
 *  not a single flat value — see resolveRateLimits in quota.ts. */
async function resolveBand(): Promise<QuotaBand | "unknown"> {
  const cache = await readRateLimitsCache();
  const resolved = resolveRateLimits(cache?.sessions, Date.now());
  if (!resolved) return "unknown";
  return computeBand(resolved.five_hour?.used_percentage, resolved.seven_day?.used_percentage);
}

async function main(): Promise<void> {
  const input = await readHookInput<{ prompt: string; session_id: string }>({
    prompt: "PROMPT",
    session_id: "CLAUDE_SESSION_ID",
  });
  // Session id is used verbatim in the state-file NAME below — validate before
  // it reaches a filename, same convention session-ledger.ts's appendEntries/
  // readDigest gate on (and post-failure.ts's writer side now matches).
  const sessionId = isSafeSessionId(input.session_id) ? input.session_id : "unknown";

  const signatures = await readState<SignatureMap>(`problem-signatures-${sessionId}`, {});

  const [state, band, sessionModel] = await Promise.all([
    readEscalateState(),
    resolveBand(),
    readSessionModel(sessionId),
  ]);
  const top = topUnannouncedSignature(signatures, state, sessionId);
  const now = Date.now();

  if (!shouldEscalate(top, THRESHOLD, state, now, band)) return;
  // top is non-null here: shouldEscalate returns false when top is null.
  if (!top) return;

  emitAdditionalContext("UserPromptSubmit", buildEscalateMessage(top, THRESHOLD, sessionModel));
  await writeEscalateState(withAnnouncement(state, sessionId, top.key, now));
  await recordFired(sessionId, top, sessionModel);
}

await runHook(main);
