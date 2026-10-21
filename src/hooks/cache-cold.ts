#!/usr/bin/env bun
// UserPromptSubmit hook: warn the user when the prompt cache has expired and
// the context is large, so this message re-sends it uncached. The payload has
// no cache state; src/lib/cache-cold.ts derives it from the transcript tail.
// Shown to the user only (systemMessage). Never blocks. Fail-open.
//
// Once per cold gap without state: the message it warns about writes the
// cache again, so the next prompt finds a fresh assistant entry and is silent.

import { coldResend, coldResendMessage, readLastUsage } from "../lib/cache-cold.ts";
import { type HookIO, processIO, runHook } from "../lib/hook-runtime.ts";

export async function main(io: HookIO = processIO, now: number = Date.now()): Promise<void> {
  // Also drains stdin when run alone (see quota-steer.ts).
  const { prompt, transcript_path: transcript } = await io.hookInput<{
    prompt: string;
    transcript_path: string;
  }>({ prompt: "PROMPT" });
  // Hooks fire before a slash command expands: /clear and /handoff, the
  // commands the warning points at, must not trigger it.
  if (typeof prompt === "string" && prompt.trimStart().startsWith("/")) return;
  if (typeof transcript !== "string" || !transcript) return;
  const last = await readLastUsage(transcript);
  const cold = last && coldResend(last, now);
  if (cold) io.notice(coldResendMessage(cold));
}

if (import.meta.main) await runHook(main);
