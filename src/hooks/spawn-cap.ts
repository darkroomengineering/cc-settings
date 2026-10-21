#!/usr/bin/env bun
// Spawn Cap — PreToolUse hook. Counts the Agent tool calls of each session and
// asks the user at the 30th, then every 15th after it (45, 60, …), so a
// fan-out stuck in a loop stops for a human instead of spawning without end.
// It never blocks: Workflows and ultracode legitimately start dozens of agents.
//
// Agents started by a Workflow script do not go through the Agent tool, so
// they never reach this hook and are not counted.
//
// Agent calls sent in one message run this hook in parallel, so the count is
// not a read-modify-write: each call appends its own token line to the session
// log (a small O_APPEND write is atomic) and takes its token's position as its
// count. Every count is assigned to exactly one call, so no threshold is lost.
// Fail-open: any error allows the call (the dispatcher skips a throwing handler).

import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pruneStaleFiles } from "../lib/artifact-store.ts";
import { type HookIO, processIO, runHook } from "../lib/hook-runtime.ts";
import { claudePath } from "../lib/platform.ts";

const FIRST_ASK = 30;
const ASK_EVERY = 15;
const STATE_PREFIX = "spawn-count-";
const STATE_MAX_AGE_DAYS = 7;
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function shouldAsk(count: number): boolean {
  return count >= FIRST_ASK && (count - FIRST_ASK) % ASK_EVERY === 0;
}

/** Position of `token` among the token lines of `log`, 1-based; 0 if absent.
 *  Lines that are not tokens (a corrupt or foreign file) are not counted. */
export function tokenPosition(log: string, token: string): number {
  let position = 0;
  for (const line of log.split("\n")) {
    if (!TOKEN_RE.test(line)) continue;
    position++;
    if (line === token) return position;
  }
  return 0;
}

async function pruneStale(dir: string): Promise<void> {
  const stale = await pruneStaleFiles(dir, new RegExp(`^${STATE_PREFIX}`), STATE_MAX_AGE_DAYS);
  await Promise.all(stale.map((file) => unlink(file).catch(() => {})));
}

export async function main(io: HookIO = processIO): Promise<void> {
  const { tool_name: tool, session_id: sessionId } = await io.hookInput<{
    tool_name: string;
    session_id: string;
  }>({ tool_name: "TOOL_NAME", session_id: "CLAUDE_CODE_SESSION_ID" });
  if (tool !== "Agent" && tool !== "Task") return;
  if (typeof sessionId !== "string" || !sessionId) return;

  const dir = claudePath("tmp");
  const file = join(
    dir,
    `${STATE_PREFIX}${createHash("sha256").update(sessionId).digest("hex")}.log`,
  );
  const token = randomUUID();
  await mkdir(dir, { recursive: true });
  // The leading newline keeps the token on its own line even after a torn or foreign write.
  await appendFile(file, `\n${token}`);
  const count = tokenPosition(await readFile(file, "utf8"), token);
  if (count === 1) await pruneStale(dir);

  if (shouldAsk(count)) {
    io.ask(
      `[Spawn Cap] this session has started ${count} subagents. ` +
        "Approve to continue; deny if a fan-out is looping.",
    );
  }
}

if (import.meta.main) await runHook(main);
