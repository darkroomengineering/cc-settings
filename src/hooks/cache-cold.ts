#!/usr/bin/env bun
// Warns the user when the prompt cache has expired and the context is large,
// so the next message re-sends it uncached. Shown to the user only
// (systemMessage). Never blocks. Fail-open.
//
// UserPromptSubmit (via dispatch.ts): the payload has no cache state;
// src/lib/cache-cold.ts derives it from the transcript tail. Once per cold gap
// without state: the warned message writes the cache again, so the next prompt
// finds a fresh assistant entry and is silent.
//
// SessionStart on resume or fork (standalone): Claude Code sends its own
// staleness and cost estimate, so the user sees the cost before choosing to
// continue or /clear. A marker file then silences the first prompt's warning,
// which would repeat the same gap.

import { createHash } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pruneStaleFiles } from "../lib/artifact-store.ts";
import {
  coldResend,
  coldResendMessage,
  readLastUsage,
  resumeColdMessage,
} from "../lib/cache-cold.ts";
import { type HookIO, processIO, runHook } from "../lib/hook-runtime.ts";
import { claudePath } from "../lib/platform.ts";

const MARKER_PREFIX = "cache-cold-resume-";

function markerPath(sessionId: string): string {
  const hash = createHash("sha256").update(sessionId).digest("hex");
  return join(claudePath("tmp"), `${MARKER_PREFIX}${hash}.flag`);
}

async function markResumeWarned(sessionId: string): Promise<void> {
  const dir = claudePath("tmp");
  await mkdir(dir, { recursive: true });
  await writeFile(markerPath(sessionId), "");
  await pruneStaleFiles(dir, new RegExp(`^${MARKER_PREFIX}`), 7);
}

/** True, and the marker removed, when SessionStart already warned this gap. */
async function consumeResumeWarned(sessionId: string): Promise<boolean> {
  try {
    await unlink(markerPath(sessionId));
    return true;
  } catch {
    return false;
  }
}

export async function main(io: HookIO = processIO, now: number = Date.now()): Promise<void> {
  // Also drains stdin when run alone (see quota-steer.ts).
  const input = await io.hookInput<{
    hook_event_name: string;
    source: string;
    session_id: string;
    prompt: string;
    transcript_path: string;
    prompt_cache_likely_expired: unknown;
    context_tokens: unknown;
    seconds_since_last_response: unknown;
    estimated_cache_write_usd: unknown;
  }>({ prompt: "PROMPT" });
  const sessionId = typeof input.session_id === "string" ? input.session_id : "";

  if (input.hook_event_name === "SessionStart") {
    if (input.source !== "resume" && input.source !== "fork") return;
    const message = resumeColdMessage(input);
    if (!message) return;
    io.notice(message);
    if (sessionId) await markResumeWarned(sessionId).catch(() => {});
    return;
  }

  // Hooks fire before a slash command expands: /clear and /handoff, the
  // commands the warning points at, must not trigger it.
  const { prompt, transcript_path: transcript } = input;
  if (typeof prompt === "string" && prompt.trimStart().startsWith("/")) return;
  if (sessionId && (await consumeResumeWarned(sessionId))) return;
  if (typeof transcript !== "string" || !transcript) return;
  const last = await readLastUsage(transcript);
  const cold = last && coldResend(last, now);
  if (cold) io.notice(coldResendMessage(cold));
}

if (import.meta.main) await runHook(main);
