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

import {
  buildEscalateMessage,
  readEscalateState,
  shouldEscalate,
  topUnannouncedSignature,
  withAnnouncement,
  writeEscalateState,
} from "../lib/escalate.ts";
import { intEnv } from "../lib/hook-config.ts";
import { emitAdditionalContext, readHookInput, readState, runHook } from "../lib/hook-runtime.ts";
import type { SignatureMap } from "../lib/problem-signature.ts";
import { CACHE_STALE_MS, computeBand, type QuotaBand, readRateLimitsCache } from "../lib/quota.ts";
import { isSafeSessionId } from "../lib/session-ledger.ts";
import { readSessionModel } from "../lib/session-model.ts";

// Same env-override precedent as CC_PARALLELMAX_THRESHOLD (hook-config.ts) —
// default 3 matches post-failure.ts's existing "repeated failure" bar.
const THRESHOLD = intEnv("CC_ESCALATE_THRESHOLD", 3);

/** "unknown" when the rate-limit cache is missing or stale (same staleness
 *  window quota-steer.ts uses) — treated as NOT elevated/critical, so a dead/
 *  never-populated cache fails open toward the suggestion rather than
 *  silence. */
async function resolveBand(): Promise<QuotaBand | "unknown"> {
  const cache = await readRateLimitsCache();
  if (!cache || Date.now() - cache.updated_at > CACHE_STALE_MS) return "unknown";
  return computeBand(cache.five_hour?.used_percentage, cache.seven_day?.used_percentage);
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
}

await runHook(main);
