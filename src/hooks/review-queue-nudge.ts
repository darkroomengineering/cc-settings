#!/usr/bin/env bun
// PostToolUse hook — review-queue backpressure (the consumer-side counterpart
// to parallelmax-nudge). Counts Agent spawns since the last commit, nudges when
// the queue reaches CC_MAX_UNREVIEWED, and resets on `git commit`.
// Fail-open: any error → silent success (never break the tool call).
//
// No matcher in config/40-hooks.json (fires on every PostToolUse, like
// parallelmax-nudge) — it branches on tool_name internally.

import { readHookInput, readState, runHook, writeState } from "../lib/hook-runtime.ts";
import {
  buildNudge,
  isGitCommit,
  maxUnreviewed,
  onAgentSpawn,
  onCommit,
  type ReviewQueueState,
  shouldNudge,
} from "../lib/review-queue.ts";

const STATE_FILE = "review-queue.json";

async function main(): Promise<void> {
  const payload = await readHookInput<{
    tool_name: string;
    tool_input: { command?: string };
  }>({ tool_name: "TOOL_NAME" });
  const toolName = payload.tool_name ?? "";

  // Drain: a commit closes the loop, resetting the queue.
  if (toolName === "Bash") {
    const command = payload.tool_input?.command ?? "";
    if (command && isGitCommit(command)) {
      await writeState(STATE_FILE, onCommit());
    }
    return;
  }

  // Producer: every agent spawned is one more unit awaiting review.
  if (toolName !== "Agent") return;

  const next = onAgentSpawn(await readState<ReviewQueueState>(STATE_FILE, { awaiting: 0 }));
  const max = maxUnreviewed();

  if (shouldNudge(next, max, Date.now())) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: buildNudge(next.awaiting, max),
        },
      }),
    );
    next.firedAt = Date.now();
  }

  await writeState(STATE_FILE, next);
}

await runHook(main);
