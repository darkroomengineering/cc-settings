#!/usr/bin/env bun
// PostToolUse hook — review-queue backpressure. Counts reviewable Agent
// spawns, nudges at CC_MAX_UNREVIEWED, drains on successful commit/push,
// reconciles when HEAD moves, and flags a deep queue committed too fast.
// runHook keeps failures silent so they never break a tool call.

import { runGit } from "../lib/git.ts";
import {
  emitAdditionalContext,
  readHookInput,
  readState,
  runHook,
  writeState,
} from "../lib/hook-runtime.ts";
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
  ReviewQueueStateSchema,
  shouldNudge,
} from "../lib/review-queue.ts";

const QUEUE_STATE = "review-queue.json";

type Payload = {
  tool_name: string;
  tool_input: {
    command?: string;
    subagent_type?: string;
  };
  tool_response: BashResult;
  cwd?: string;
};

/** Current HEAD SHA in `cwd`, or undefined if git can't be read (fail-soft). */
async function currentHead(cwd: string): Promise<string | undefined> {
  const out = (await runGit(["rev-parse", "HEAD"], { cwd })).trim();
  return out || undefined;
}

/** Read + validate review-queue.json the same way statusline.ts does (N2) —
 *  a corrupted/hand-edited state file degrades to the empty-queue default
 *  instead of feeding garbage into the arithmetic below. Never throws. */
async function readQueueState(): Promise<ReviewQueueState> {
  const raw = await readState<unknown>(QUEUE_STATE, null);
  const parsed = ReviewQueueStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : { awaiting: 0 };
}

async function reviewQueueBranch(payload: Partial<Payload>, toolName: string): Promise<void> {
  if (toolName === "Bash") {
    const command = payload.tool_input?.command ?? "";
    if (!command) return;
    const cwd = payload.cwd ?? process.cwd();

    // Drain: a SUCCESSFUL commit closes the loop. A failed commit (nothing to
    // commit, a rejecting pre-commit hook, a blocked merge) must not reset the
    // queue. Run the cognitive-surrender check on the pre-reset state, then reset.
    if (isGitCommit(command) && commitSucceeded(payload.tool_response)) {
      const state = await readQueueState();
      const now = Date.now();
      if (isCognitiveSurrender(state, now, maxUnreviewed(), minReviewSeconds() * 1000)) {
        const dwellSeconds = Math.round((now - (state.firstSpawnAt ?? now)) / 1000);
        emitAdditionalContext("PostToolUse", buildSurrenderNudge(state.awaiting, dwellSeconds));
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
      const state = await readQueueState();
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
  const next = onAgentSpawn(await readQueueState(), now);
  const max = maxUnreviewed();

  if (shouldNudge(next, max, now)) {
    emitAdditionalContext("PostToolUse", buildNudge(next.awaiting, max));
    next.firedAt = now;
  }

  await writeState(QUEUE_STATE, next);
}

await runHook(async () => {
  const payload = await readHookInput<Payload>({ tool_name: "TOOL_NAME" });
  await reviewQueueBranch(payload, payload.tool_name ?? "");
});
