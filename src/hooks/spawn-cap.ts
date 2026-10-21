#!/usr/bin/env bun
// Spawn Cap — PreToolUse hook. Counts the Agent tool calls of each session and
// asks the user at the 30th, then every 15th after it (45, 60, …), so a
// fan-out stuck in a loop stops for a human instead of spawning without end.
// It never blocks: Workflows and ultracode legitimately start dozens of agents.
//
// Agents started by a Workflow script do not go through the Agent tool, so
// they never reach this hook and are not counted.
//
// Concurrent Agent calls in one message run this hook in parallel. Each process
// writes read+1, so a race can lose an increment but never skips a value: every
// threshold is still reached by some process, at worst asked twice.
// Fail-open: any error allows the call (the dispatcher skips a throwing handler).

import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import { pruneStaleFiles } from "../lib/artifact-store.ts";
import { type HookIO, processIO, readState, runHook, writeState } from "../lib/hook-runtime.ts";
import { claudePath } from "../lib/platform.ts";

const FIRST_ASK = 30;
const ASK_EVERY = 15;
const STATE_PREFIX = "spawn-count-";
const STATE_MAX_AGE_DAYS = 7;

interface SpawnCount {
  count: number;
}

export function shouldAsk(count: number): boolean {
  return count >= FIRST_ASK && (count - FIRST_ASK) % ASK_EVERY === 0;
}

function stateFile(sessionId: string): string {
  return `${STATE_PREFIX}${createHash("sha256").update(sessionId).digest("hex")}.json`;
}

async function pruneStale(): Promise<void> {
  const stale = await pruneStaleFiles(
    claudePath("tmp"),
    new RegExp(`^${STATE_PREFIX}`),
    STATE_MAX_AGE_DAYS,
  );
  await Promise.all(stale.map((file) => unlink(file).catch(() => {})));
}

export async function main(io: HookIO = processIO): Promise<void> {
  const { tool_name: tool, session_id: sessionId } = await io.hookInput<{
    tool_name: string;
    session_id: string;
  }>({ tool_name: "TOOL_NAME", session_id: "CLAUDE_CODE_SESSION_ID" });
  if (tool !== "Agent" && tool !== "Task") return;
  if (typeof sessionId !== "string" || !sessionId) return;

  const name = stateFile(sessionId);
  const { count: stored } = await readState<SpawnCount>(name, { count: 0 });
  const count = (Number.isSafeInteger(stored) && stored > 0 ? stored : 0) + 1;
  await writeState(name, { count });
  if (count === 1) await pruneStale();

  if (shouldAsk(count)) {
    io.ask(
      `[Spawn Cap] this session has started ${count} subagents. ` +
        "Approve to continue; deny if a fan-out is looping.",
    );
  }
}

if (import.meta.main) await runHook(main);
