#!/usr/bin/env bun
// UserPromptSubmit hook — detect breadth signals in the incoming prompt and report
// them before the model plans. It names the signal only; the delegation rule itself
// lives in CLAUDE.md and is already in context.
// Fail-open: any error → silent success (never block the prompt).
//
// Two detectors. With a TypeSafe key, Jev scores the prompt against one
// statement (JEV_INSTRUCTIONS) and its probability decides at JEV_THRESHOLD;
// the prompt text leaves the machine for that call. Without a key, or when
// the call fails or exceeds JEV_TIMEOUT_MS, the regex score below decides as
// it did before 15.23.0. Measured on 1,102 real prompts (2026-09-18): the
// regex fired 21 times with 10 correct; Jev at 0.7 fired 83 times with 53
// correct, where "correct" means the turn went on to touch 3+ files or make
// 12+ tool calls.
//
// Fired-vs-acted telemetry: when the advisory speaks (score >= 2), it also
// records a "fired" line to the same cross-session log escalate-model.ts
// uses (see escalate-telemetry.ts), plus a per-session pending marker that
// escalate-acted.ts consumes to tell whether the nudge was followed by a
// subagent spawn. Recording happens strictly AFTER emitAdditionalContext and
// never gates it — telemetry failure must never be the reason this advisory
// fails to speak. PRIVACY: the fired line carries only the integer score,
// never the matched phrase text or any prompt-derived string; the Jev
// probability is a number about the prompt, not text from it.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  buildDelegationFiredEvent,
  delegationPendingStateName,
  TELEMETRY_LOG,
  toJsonLine,
} from "../lib/escalate-telemetry.ts";
import { emitAdditionalContext, readHookInput, runHook, writeState } from "../lib/hook-runtime.ts";
import { jevNoul, typesafeKey } from "../lib/jev.ts";
import { isoNow } from "../lib/platform.ts";
import { isSafeSessionId } from "../lib/session-ledger.ts";

const BREADTH_PHRASES: RegExp[] = [
  /do all\b/i,
  /do everything\b/i,
  /execute\s+(the|that|this)?\s*plan/i,
  /now make it happen/i,
  /across the\s+(repo|codebase|repository|project)/i,
  /every\s+(file|skill|module|component)/i,
  /all of\s+(the|them|these|those)/i,
  /refactor\s+(the\s+)?(whole|entire|full)/i,
  /batch\s+(this|these|all)/i,
  /multi-file/i,
  /fan\s+out/i,
];

// Rough path-shaped token: "dir/file.ext" or "file.ext" forms
const PATH_TOKEN = /\b[\w-]+\/[\w./-]+|\b[\w-]+\.(ts|tsx|js|jsx|md|json|css|scss)\b/gi;

// List item: "- item", "* item", "1. item"
const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s+/gm;

export const JEV_THRESHOLD = 0.7;
// Under the hook's 3 s timeout in config/40-hooks.json; p95 measured at 419 ms.
export const JEV_TIMEOUT_MS = 2000;
export const JEV_INSTRUCTIONS =
  "This request asks for work that would touch three or more files, or need a dozen or more tool calls, or run several independent workstreams, so an engineer would hand it to subagents instead of doing it inline";

/** Regex breadth score and the reasons behind it. Pure; exported for tests. */
export function breadthScore(prompt: string): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  for (const rx of BREADTH_PHRASES) {
    const matches = prompt.match(rx);
    if (matches) {
      score += 2;
      reasons.push(`breadth phrase matched: "${matches[0] ?? ""}"`);
    }
  }
  const pathMatches = prompt.match(PATH_TOKEN) ?? [];
  if (pathMatches.length >= 3) {
    score += 1;
    reasons.push(`${pathMatches.length} path-shaped tokens found`);
  }
  const listMatches = prompt.match(LIST_ITEM) ?? [];
  if (listMatches.length >= 4) {
    score += 1;
    reasons.push(`${listMatches.length} list items found`);
  }
  return { score, reasons };
}

/** Record that the delegation advisory fired: one JSONL line to the shared
 *  telemetry log (score only — never the matched phrase or path tokens, a
 *  hard privacy requirement), plus a per-session pending marker that
 *  escalate-acted.ts consumes to tell whether this fire was ever acted on.
 *  Fail-open at every IO step — telemetry must never be the reason the
 *  advisory itself fails to speak. */
async function recordDelegationFired(
  sessionId: string,
  score: number,
  jev?: number,
): Promise<void> {
  const at = Date.now();
  const event = buildDelegationFiredEvent({ t: isoNow(), session: sessionId, at, score, jev });
  await mkdir(dirname(TELEMETRY_LOG), { recursive: true }).catch(() => {});
  await appendFile(TELEMETRY_LOG, toJsonLine(event)).catch(() => {});
  await writeState(delegationPendingStateName(sessionId), { at, firedAt: at }).catch(() => {});
}

async function main(): Promise<void> {
  const input = await readHookInput<{ prompt: string; session_id: string }>({
    prompt: "PROMPT",
    session_id: "CLAUDE_SESSION_ID",
  });
  const prompt = input.prompt ?? "";

  if (!prompt) return;

  const { score, reasons } = breadthScore(prompt);

  // Jev decides when it answers; the regex decides when it cannot.
  const key = await typesafeKey();
  const jev = key
    ? await jevNoul({ key, prompt, instructions: JEV_INSTRUCTIONS, timeoutMs: JEV_TIMEOUT_MS })
    : null;
  if (jev !== null) {
    if (jev < JEV_THRESHOLD) return;
    reasons.unshift(`Jev delegation probability ${jev.toFixed(2)}`);
  } else if (score < 2) {
    return;
  }

  // Report the signal only. The delegation rule itself lives in CLAUDE.md and is
  // already in context — restating it here would be the same instruction twice.
  const msg =
    `Breadth signals in this prompt (${jev !== null ? `Jev ${jev.toFixed(2)}` : `score ${score}`}): ${reasons.join("; ")}. ` +
    `Apply the delegation heuristic. If it fires, open with one clarifying round ` +
    `(AskUserQuestion, up to 4 questions, recommendation first) before starting.`;

  emitAdditionalContext("UserPromptSubmit", msg);

  const sessionId = isSafeSessionId(input.session_id) ? input.session_id : "unknown";
  await recordDelegationFired(sessionId, score, jev ?? undefined);
}

if (import.meta.main) await runHook(main);
