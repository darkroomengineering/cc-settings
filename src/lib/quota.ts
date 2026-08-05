import { z } from "zod";
import type { CodexState } from "./codex.ts";
import { readValidatedState, writeState } from "./hook-runtime.ts";

export type QuotaBand = "normal" | "elevated" | "critical" | "exhausted";

const RateLimitWindowSchema = z.object({
  used_percentage: z.number().optional(),
  resets_at: z.string().optional(),
});

const RateLimitsCacheSchema = z.object({
  five_hour: RateLimitWindowSchema.optional(),
  seven_day: RateLimitWindowSchema.optional(),
  updated_at: z.number(),
});

export type RateLimitsCache = z.infer<typeof RateLimitsCacheSchema>;

export const FIVE_HOUR_ELEVATED = 60;
export const FIVE_HOUR_CRITICAL = 85;
export const SEVEN_DAY_ELEVATED = 65;
export const SEVEN_DAY_CRITICAL = 85;
export const EXHAUSTED_THRESHOLD = 95;
export const CACHE_STALE_MS = 10 * 60_000;
export const CRITICAL_REMIND_MS = 30 * 60_000;

export const RATE_LIMITS_CACHE_FILE = "rate-limits.json";
export const QUOTA_STEER_STATE_FILE = "quota-steer-state.json";

const QuotaSteerStateSchema = z.object({
  band: z.enum(["normal", "elevated", "critical", "exhausted"]),
  lastEmit: z.number(),
});

export type QuotaSteerState = z.infer<typeof QuotaSteerStateSchema>;

const CODEX_AVAILABLE: CodexState = "available";

function severity(band: QuotaBand): number {
  if (band === "exhausted") return 3;
  if (band === "critical") return 2;
  if (band === "elevated") return 1;
  return 0;
}

function dimensionBand(
  pct: number | undefined,
  elevatedThreshold: number,
  criticalThreshold: number,
): QuotaBand {
  if (pct === undefined) return "normal";
  if (pct >= EXHAUSTED_THRESHOLD) return "exhausted";
  if (pct >= criticalThreshold) return "critical";
  if (pct >= elevatedThreshold) return "elevated";
  return "normal";
}

function formatPct(label: string, pct: number | undefined): string {
  return pct === undefined ? `${label} unknown` : `${label} ${Math.round(pct)}%`;
}

export function computeBand(
  fiveHourPct: number | undefined,
  sevenDayPct: number | undefined,
): QuotaBand {
  const fiveHourBand = dimensionBand(fiveHourPct, FIVE_HOUR_ELEVATED, FIVE_HOUR_CRITICAL);
  const sevenDayBand = dimensionBand(sevenDayPct, SEVEN_DAY_ELEVATED, SEVEN_DAY_CRITICAL);
  return severity(fiveHourBand) >= severity(sevenDayBand) ? fiveHourBand : sevenDayBand;
}

export function shouldEmit(
  prev: { band: QuotaBand; lastEmit: number } | null,
  band: QuotaBand,
  now: number,
): boolean {
  if (band === "normal") return false;
  if (prev === null) return true;
  if (severity(band) > severity(prev.band)) return true;
  if (band === "exhausted") return true;
  return band === "critical" && now - prev.lastEmit >= CRITICAL_REMIND_MS;
}

// `resets_at` is Unix epoch seconds on current Claude Code builds; older builds
// emitted ISO strings. Normalise both before formatting — the pre-v12 version of
// this helper did a bare Date.parse(iso), which returns NaN for "1753600000" and
// would silently drop the ↻ suffix now that the payload carries epoch seconds.
//
// Days form: the 7-day window's reset can be days out, and "132h45m" reads
// badly — past 48h this returns "5d12h" instead. Safe for the statusline ⚡
// chip, which only ever formats the 5h window (always under 48h).
export function formatTimeToReset(value: number | string | undefined): string | null {
  if (value === undefined) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  let resetMs: number;
  if (value !== "" && Number.isFinite(numeric)) {
    // Below ~1e11 is seconds (that boundary is year 5138); larger is already ms.
    resetMs = numeric < 1e11 ? numeric * 1000 : numeric;
  } else {
    resetMs = Date.parse(String(value));
  }
  if (Number.isNaN(resetMs)) return null;
  const deltaMs = resetMs - Date.now();
  if (deltaMs <= 0) return null;
  const totalMin = Math.round(deltaMs / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 48) {
    const d = Math.floor(h / 24);
    const remH = h % 24;
    return `${d}d${remH}h`;
  }
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}m` : `${m}m`;
}

export function buildSteerMessage(
  band: QuotaBand,
  codexState: string,
  fiveHourPct: number | undefined,
  sevenDayPct: number | undefined,
  fiveHourResetsAt?: string,
  sevenDayResetsAt?: string,
): string {
  const marker = `[quota:${band}]`;
  const usage = `${formatPct("5h", fiveHourPct)}, ${formatPct("7d", sevenDayPct)}`;
  const codexAvailable = codexState === CODEX_AVAILABLE;
  // Exhaustion can be tripped by the weekly window alone (5h still under 95%) —
  // in that case the 5h reset time is irrelevant/misleading, so bind the note
  // to whichever window actually tripped. When both trip, the 5h window wins
  // since it resets first and is the more actionable number.
  const fiveTripped = fiveHourPct !== undefined && fiveHourPct >= EXHAUSTED_THRESHOLD;
  const sevenTripped = sevenDayPct !== undefined && sevenDayPct >= EXHAUSTED_THRESHOLD;
  const sevenBinding = sevenTripped && !fiveTripped;
  const reset = formatTimeToReset(sevenBinding ? sevenDayResetsAt : fiveHourResetsAt);
  const resetNote = reset
    ? ` The ${sevenBinding ? "weekly" : "5h"} window resets in ${reset}.`
    : "";

  if (codexAvailable && band === "exhausted") {
    return `${marker} Claude usage is nearly exhausted (${usage}) — the hard limit is imminent.${resetNote} Route ALL executable work (implementation, review, bulk edits) to Codex via bun codex-run.ts exec in large batched calls; keep Claude turns orchestration-only and as short as possible; spawn no Claude subagents. IMPORTANT: in your next response, tell the user plainly that Claude usage is nearly exhausted and work is being routed to Codex until the window resets.`;
  }

  if (band === "exhausted") {
    return `${marker} Claude usage is nearly exhausted (${usage}) — the hard limit is imminent, and the Codex bridge is ${codexState}.${resetNote} Keep turns minimal and defer all non-essential work. IMPORTANT: in your next response, tell the user plainly that Claude usage is nearly exhausted and recommend they pause until the window resets or switch to a smaller model via /model sonnet.`;
  }

  if (codexAvailable && band === "critical") {
    return `${marker} Claude quota is critical (${usage}). Avoid Opus/Fable subagents entirely; delegate all executable work to Codex in one large batched call via bun codex-run.ts exec, and keep main-session output lean.`;
  }

  if (codexAvailable && band === "elevated") {
    return `${marker} Claude usage is elevated (${usage}). Route bulk/mechanical implementation to Codex via bun codex-run.ts exec, batched into few large calls; keep subagents on sonnet and reserve Opus/Fable turns for planning, synthesis, and gate decisions.`;
  }

  if (band === "critical") {
    return `${marker} Claude quota is critical (${usage}), and the Codex bridge is ${codexState}. Downshift subagents to sonnet, defer bulk work, keep turns lean, and do not attempt the codex bridge while it is ${codexState}.`;
  }

  return `${marker} Claude usage is elevated (${usage}), and the Codex bridge is ${codexState}. Downshift subagents to sonnet, defer bulk work, keep turns lean, and do not attempt the codex bridge while it is ${codexState}.`;
}

export async function readRateLimitsCache(): Promise<RateLimitsCache | null> {
  return readValidatedState(RATE_LIMITS_CACHE_FILE, RateLimitsCacheSchema, null);
}

export async function writeRateLimitsCache(cache: RateLimitsCache): Promise<void> {
  await writeState(RATE_LIMITS_CACHE_FILE, cache);
}

export async function readQuotaSteerState(): Promise<QuotaSteerState | null> {
  return readValidatedState(QUOTA_STEER_STATE_FILE, QuotaSteerStateSchema, null);
}

export async function writeQuotaSteerState(state: QuotaSteerState): Promise<void> {
  await writeState(QUOTA_STEER_STATE_FILE, state);
}
