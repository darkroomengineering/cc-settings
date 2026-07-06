#!/usr/bin/env bun
// UserPromptSubmit hook — inject quota-aware model-routing guidance when the
// statusline's cached Claude usage crosses elevated/critical thresholds.
// Fail-open: any error → silent success (never block the prompt).

import { readCodexVerdict } from "../lib/codex.ts";
import { readHookInput, runHook } from "../lib/hook-runtime.ts";
import {
  buildSteerMessage,
  CACHE_STALE_MS,
  computeBand,
  readQuotaSteerState,
  readRateLimitsCache,
  shouldEmit,
  writeQuotaSteerState,
} from "../lib/quota.ts";

async function main(): Promise<void> {
  await readHookInput<{ prompt: string }>({ prompt: "PROMPT" });

  const now = Date.now();
  const cache = await readRateLimitsCache();
  if (!cache || now - cache.updated_at > CACHE_STALE_MS) return;

  const fiveHourPct = cache.five_hour?.used_percentage;
  const sevenDayPct = cache.seven_day?.used_percentage;
  const band = computeBand(fiveHourPct, sevenDayPct);
  const prev = await readQuotaSteerState();

  if (band === "normal") {
    await writeQuotaSteerState({ band, lastEmit: prev?.lastEmit ?? 0 });
    return;
  }

  const codexVerdict = await readCodexVerdict();
  if (shouldEmit(prev, band, now)) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: buildSteerMessage(band, codexVerdict.state, fiveHourPct, sevenDayPct),
        },
      }),
    );
    await writeQuotaSteerState({ band, lastEmit: now });
    return;
  }

  await writeQuotaSteerState({ band, lastEmit: prev?.lastEmit ?? 0 });
}

await runHook(main);
