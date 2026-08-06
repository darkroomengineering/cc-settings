#!/usr/bin/env bun
// UserPromptSubmit hook — inject quota-aware model-routing guidance when the
// statusline's cached Claude usage crosses elevated/critical thresholds.
// Fail-open: any error → silent success (never block the prompt).

import { readCodexVerdict } from "../lib/codex.ts";
import { emitAdditionalContext, readHookInput, runHook } from "../lib/hook-runtime.ts";
import {
  buildSteerMessage,
  computeBand,
  readQuotaSteerState,
  readRateLimitsCache,
  resolveRateLimits,
  shouldEmit,
  writeQuotaSteerState,
} from "../lib/quota.ts";

async function main(): Promise<void> {
  // Drain stdin even though nothing here needs the prompt text. readHookInput
  // reads Bun.stdin to EOF; a UserPromptSubmit payload carries the whole prompt,
  // which on a long paste exceeds the pipe buffer. Exiting without draining
  // would leave the dispatcher blocked on its write. Looks unused — is not.
  // (delegation-detector.ts is the sibling UserPromptSubmit hook that does
  // consume the value; this one only needs the read's side effect.)
  await readHookInput<{ prompt: string }>({ prompt: "PROMPT" });

  const now = Date.now();
  const cache = await readRateLimitsCache();
  // Prune stale sessions, then take the max used_percentage per window across
  // survivors (resolveRateLimits) — an account-wide counter observed by many
  // concurrent workspaces at different times, not a single flat reading.
  // null (no session survives the prune) degrades to silence: never inject a
  // stale/default number, which would misroute quota-aware guidance.
  const resolved = resolveRateLimits(cache?.sessions, now);
  if (!resolved) return;

  const fiveHourPct = resolved.five_hour?.used_percentage;
  const sevenDayPct = resolved.seven_day?.used_percentage;
  const band = computeBand(fiveHourPct, sevenDayPct);
  const prev = await readQuotaSteerState();

  if (band === "normal") {
    await writeQuotaSteerState({ band, lastEmit: prev?.lastEmit ?? 0 });
    return;
  }

  const codexVerdict = await readCodexVerdict();
  if (shouldEmit(prev, band, now)) {
    emitAdditionalContext(
      "UserPromptSubmit",
      buildSteerMessage(
        band,
        codexVerdict.state,
        fiveHourPct,
        sevenDayPct,
        resolved.five_hour?.resets_at,
        resolved.seven_day?.resets_at,
      ),
    );
    await writeQuotaSteerState({ band, lastEmit: now });
    return;
  }

  await writeQuotaSteerState({ band, lastEmit: prev?.lastEmit ?? 0 });
}

await runHook(main);
