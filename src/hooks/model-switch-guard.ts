#!/usr/bin/env bun
// PreModelSwitch hook — annotate (never block) a switch to a fable/mythos
// model when the cached weekly/5h usage is near or past the critical band.
// A timed-out PreModelSwitch hook blocks the switch, so this does exactly one
// cached-file read and nothing else. Fail-open: any error → silent success.

import { emitHookSpecificOutput, readHookInput, runHook } from "../lib/hook-runtime.ts";
import {
  computeBand,
  EXHAUSTED_THRESHOLD,
  readRateLimitsCache,
  resolveRateLimits,
} from "../lib/quota.ts";

function formatPct(pct: number): string {
  return `${Math.round(pct)}%`;
}

async function main(): Promise<void> {
  const input = await readHookInput<{ to_model: string; from_model?: string }>({
    to_model: "TO_MODEL",
    from_model: "FROM_MODEL",
  });

  // Defense in depth — the config matcher already filters on to_model, but
  // this script must not rely on that.
  if (!/fable|mythos/i.test(input.to_model ?? "")) return;

  const cache = await readRateLimitsCache();
  const resolved = resolveRateLimits(cache?.sessions, Date.now());
  if (!resolved) return;

  const fiveHourPct = resolved.five_hour?.used_percentage;
  const sevenDayPct = resolved.seven_day?.used_percentage;
  const band = computeBand(fiveHourPct, sevenDayPct);

  const parts: string[] = [];
  if (fiveHourPct !== undefined) parts.push(`${formatPct(fiveHourPct)} (5h)`);
  if (sevenDayPct !== undefined) parts.push(`${formatPct(sevenDayPct)} (weekly)`);
  const usage = parts.join(" / ");

  const exhausted =
    (sevenDayPct !== undefined && sevenDayPct >= EXHAUSTED_THRESHOLD) ||
    (fiveHourPct !== undefined && fiveHourPct >= EXHAUSTED_THRESHOLD);

  if (exhausted) {
    emitHookSpecificOutput("PreModelSwitch", {
      decision: "ask",
      reason: `Usage at ${usage}. Fable draws the pool at ~2x the Opus rate and is capped at 50% of the weekly limit; past that it bills extra-usage credits. Switch anyway?`,
    });
    return;
  }

  if (band === "critical") {
    emitHookSpecificOutput("PreModelSwitch", {
      decision: "allow",
      additionalContext: `Quota critical (${usage}). Fable draws the pool ~2x faster than Opus; keep this session's fable work scoped, or /model opus for routine turns.`,
    });
  }
}

await runHook(main);
