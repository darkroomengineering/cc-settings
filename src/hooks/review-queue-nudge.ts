#!/usr/bin/env bun

// PostToolUse hook — review-queue backpressure (the consumer-side counterpart
// to parallelmax-nudge). Counts Agent spawns since the last commit, nudges when
// the queue reaches CC_MAX_UNREVIEWED, and resets on `git commit`. On commit it
// also runs the cognitive-surrender check (a deep queue committed too fast).
// Fail-open: any error → silent success (never break the tool call).
//
// No matcher in config/40-hooks.json (fires on every PostToolUse, like
// parallelmax-nudge) — it branches on tool_name internally.

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

const STATE_FILE = "review-queue.json";

/** Current HEAD SHA in `cwd`, or undefined if git can't be read (fail-soft). */
async function currentHead(cwd: string): Promise<string | undefined> {
  const out = (await runGit(["rev-parse", "HEAD"], { cwd })).trim();
  return out || undefined;
}

function emit(context: string): void {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context },
    }),
  );
}

async function main(): Promise<void> {
  const payload = await readHookInput<{
    tool_name: string;
    tool_input: { command?: string; subagent_type?: string };
    tool_response: BashResult;
    cwd?: string;
  }>({ tool_name: "TOOL_NAME" });
  const toolName = payload.tool_name ?? "";

  if (toolName === "Bash") {
    const command = payload.tool_input?.command ?? "";
    if (!command) return;
    const cwd = payload.cwd ?? process.cwd();

    // Drain: a SUCCESSFUL commit closes the loop. A failed commit (nothing to
    // commit, a rejecting pre-commit hook, a blocked merge) must not reset the
    // queue. Run the cognitive-surrender check on the pre-reset state, then reset.
    if (isGitCommit(command) && commitSucceeded(payload.tool_response)) {
      const state = await readState<ReviewQueueState>(STATE_FILE, { awaiting: 0 });
      const now = Date.now();
      if (isCognitiveSurrender(state, now, maxUnreviewed(), minReviewSeconds() * 1000)) {
        const dwellSeconds = Math.round((now - (state.firstSpawnAt ?? now)) / 1000);
        emit(buildSurrenderNudge(state.awaiting, dwellSeconds));
      }
      await writeState(STATE_FILE, onCommit(await currentHead(cwd)));
      return;
    }

    // Drain: a successful push sent the work off for review/CI — a clean
    // "I'm done with this batch" boundary.
    if (isGitPush(command) && pushSucceeded(payload.tool_response)) {
      await writeState(STATE_FILE, onCommit(await currentHead(cwd)));
      return;
    }

    // Reconcile: pull/merge/rebase/reset/checkout/switch can advance HEAD past
    // our baseline without a Claude commit (ff-pull, pulled-down PR merge).
    // Draining only happens when HEAD actually changed (see onHeadObserved).
    if (movesHead(command)) {
      const state = await readState<ReviewQueueState>(STATE_FILE, { awaiting: 0 });
      await writeState(STATE_FILE, onHeadObserved(state, await currentHead(cwd)));
      return;
    }

    return;
  }

  // Producer: every agent spawned is one more unit awaiting review — except
  // read-only agents (explore, oracle, …) that leave no diff to commit.
  if (toolName !== "Agent") return;
  if (!isReviewableAgent(payload.tool_input?.subagent_type)) return;

  const now = Date.now();
  const next = onAgentSpawn(await readState<ReviewQueueState>(STATE_FILE, { awaiting: 0 }), now);
  const max = maxUnreviewed();

  if (shouldNudge(next, max, now)) {
    emit(buildNudge(next.awaiting, max));
    next.firedAt = now;
  }

  await writeState(STATE_FILE, next);
}

await runHook(main);
