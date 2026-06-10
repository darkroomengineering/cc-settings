#!/usr/bin/env bun
// PostToolUse hook — tool-cadence nudges. Merge of two hooks that each ran
// unmatched on EVERY PostToolUse (two Bun spawns per tool call → one):
//
//   • parallelmax branch (was parallelmax-nudge.ts) — counts consecutive
//     non-Agent tool calls; at 8, nudges the model toward delegation.
//   • review-queue branch (was review-queue-nudge.ts) — backpressure, the
//     consumer-side counterpart: counts Agent spawns since the last commit,
//     nudges at CC_MAX_UNREVIEWED, drains on successful commit/push,
//     reconciles when HEAD moves, and flags cognitive surrender (a deep
//     queue committed too fast) on commit.
//
// One stdin read feeds both branches. Each branch is individually fail-open
// (mirroring the formerly-separate processes), and the whole hook runs under
// runHook — any error → silent success, never break a tool call.

import { runGit } from "../lib/git.ts";
import { readHookInput, readState, runHook, writeState } from "../lib/hook-runtime.ts";
import {
  type BashResult,
  buildNudge,
  buildSurrenderNudge,
  commitSucceeded,
  isCognitiveSurrender,
  isGitCommit,
  isGitPush,
  isReviewableAgent,
  maxUnreviewed,
  minReviewSeconds,
  movesHead,
  onAgentSpawn,
  onCommit,
  onHeadObserved,
  pushSucceeded,
  type ReviewQueueState,
  shouldNudge,
} from "../lib/review-queue.ts";

const THRESHOLD = 8;
const DEBOUNCE_MS = 60_000;
const COUNTER_STATE = "parallelmax-counter.json";
const QUEUE_STATE = "review-queue.json";

interface CounterState {
  count: number;
  lastTool: string;
  firedAt?: number;
}

type Payload = {
  tool_name: string;
  tool_input: { command?: string; subagent_type?: string };
  tool_response: BashResult;
  cwd?: string;
};

function emit(context: string): void {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context },
    }),
  );
}

/** Current HEAD SHA in `cwd`, or undefined if git can't be read (fail-soft). */
async function currentHead(cwd: string): Promise<string | undefined> {
  const out = (await runGit(["rev-parse", "HEAD"], { cwd })).trim();
  return out || undefined;
}

// --- Branch 1: consecutive non-Agent call counter --------------------------

async function parallelmaxBranch(toolName: string): Promise<void> {
  const state = await readState<CounterState>(COUNTER_STATE, { count: 0, lastTool: "" });

  if (toolName === "Agent") {
    await writeState(COUNTER_STATE, {
      count: 0,
      lastTool: toolName,
      firedAt: state.firedAt,
    });
    return;
  }

  state.count += 1;
  state.lastTool = toolName;

  if (state.count >= THRESHOLD) {
    const now = Date.now();
    // Debounce: skip if we fired recently to avoid spamming.
    if (!state.firedAt || now - state.firedAt >= DEBOUNCE_MS) {
      // Suppress the "delegate more" nudge when the review queue is already at/
      // over capacity: pushing more production when review is the bottleneck is
      // the orchestration-tax failure mode (the review-queue branch covers the
      // other direction). Still debounce + reset so we don't re-check on every
      // call.
      const rq = await readState<{ awaiting: number }>(QUEUE_STATE, { awaiting: 0 });
      if (rq.awaiting < maxUnreviewed()) {
        const msg =
          `You have made ${state.count} consecutive tool calls without delegating to an Agent. ` +
          `Opus 4.8 defaults to self-execution, but CLAUDE.md requires delegation when tasks span ` +
          `3+ files or 10+ tool calls. Consider Agent(implementer), Agent(explore), or Agent(maestro) ` +
          `to parallelize work, reduce context pressure, and follow the project guardrails.`;
        emit(msg);
      }
      state.firedAt = now;
      state.count = 0;
    }
  }

  await writeState(COUNTER_STATE, state);
}

// --- Branch 2: review-queue backpressure ------------------------------------

async function reviewQueueBranch(payload: Partial<Payload>, toolName: string): Promise<void> {
  if (toolName === "Bash") {
    const command = payload.tool_input?.command ?? "";
    if (!command) return;
    const cwd = payload.cwd ?? process.cwd();

    // Drain: a SUCCESSFUL commit closes the loop. A failed commit (nothing to
    // commit, a rejecting pre-commit hook, a blocked merge) must not reset the
    // queue. Run the cognitive-surrender check on the pre-reset state, then reset.
    if (isGitCommit(command) && commitSucceeded(payload.tool_response)) {
      const state = await readState<ReviewQueueState>(QUEUE_STATE, { awaiting: 0 });
      const now = Date.now();
      if (isCognitiveSurrender(state, now, maxUnreviewed(), minReviewSeconds() * 1000)) {
        const dwellSeconds = Math.round((now - (state.firstSpawnAt ?? now)) / 1000);
        emit(buildSurrenderNudge(state.awaiting, dwellSeconds));
      }
      await writeState(QUEUE_STATE, onCommit(await currentHead(cwd)));
      return;
    }

    // Drain: a successful push sent the work off for review/CI — a clean
    // "I'm done with this batch" boundary.
    if (isGitPush(command) && pushSucceeded(payload.tool_response)) {
      await writeState(QUEUE_STATE, onCommit(await currentHead(cwd)));
      return;
    }

    // Reconcile: pull/merge/rebase/reset/checkout/switch can advance HEAD past
    // our baseline without a Claude commit (ff-pull, pulled-down PR merge).
    // Draining only happens when HEAD actually changed (see onHeadObserved).
    if (movesHead(command)) {
      const state = await readState<ReviewQueueState>(QUEUE_STATE, { awaiting: 0 });
      await writeState(QUEUE_STATE, onHeadObserved(state, await currentHead(cwd)));
      return;
    }

    return;
  }

  // Producer: every agent spawned is one more unit awaiting review — except
  // read-only agents (explore, oracle, …) that leave no diff to commit.
  if (toolName !== "Agent") return;
  if (!isReviewableAgent(payload.tool_input?.subagent_type)) return;

  const now = Date.now();
  const next = onAgentSpawn(await readState<ReviewQueueState>(QUEUE_STATE, { awaiting: 0 }), now);
  const max = maxUnreviewed();

  if (shouldNudge(next, max, now)) {
    emit(buildNudge(next.awaiting, max));
    next.firedAt = now;
  }

  await writeState(QUEUE_STATE, next);
}

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  const payload = await readHookInput<Payload>({ tool_name: "TOOL_NAME" });
  const toolName = payload.tool_name ?? "";

  // Branch isolation: a crash in one branch must not silence the other —
  // before the merge these were separate processes. Order matches the old
  // config order (parallelmax first), so on the rare event where both nudge
  // (e.g. an 8th consecutive call that is also a draining commit) the two
  // JSON lines print in the same order as before.
  try {
    await parallelmaxBranch(toolName);
  } catch {
    // fail open
  }
  try {
    await reviewQueueBranch(payload, toolName);
  } catch {
    // fail open
  }
}

await runHook(main);
