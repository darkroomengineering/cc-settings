import { z } from "zod";
import type { CodexState } from "./codex.ts";
import { readState, writeState } from "./hook-runtime.ts";

export type QuotaBand = "normal" | "elevated" | "critical";

export interface RateLimitsCache {
  five_hour?: {
    used_percentage?: number;
    resets_at?: string;
  };
  seven_day?: {
    used_percentage?: number;
    resets_at?: string;
  };
  updated_at: number;
}

export const FIVE_HOUR_ELEVATED = 60;
export const FIVE_HOUR_CRITICAL = 85;
export const SEVEN_DAY_ELEVATED = 65;
export const SEVEN_DAY_CRITICAL = 85;
export const CACHE_STALE_MS = 10 * 60_000;
export const CRITICAL_REMIND_MS = 30 * 60_000;

export const RATE_LIMITS_CACHE_FILE = "rate-limits.json";
export const QUOTA_STEER_STATE_FILE = "quota-steer-state.json";

export interface QuotaSteerState {
  band: QuotaBand;
  lastEmit: number;
}

const CODEX_AVAILABLE: CodexState = "available";

const RateLimitWindowSchema = z.object({
  used_percentage: z.number().optional(),
  resets_at: z.string().optional(),
});

const RateLimitsCacheSchema = z.object({
  five_hour: RateLimitWindowSchema.optional(),
  seven_day: RateLimitWindowSchema.optional(),
  updated_at: z.number(),
});

const QuotaSteerStateSchema = z.object({
  band: z.enum(["normal", "elevated", "critical"]),
  lastEmit: z.number(),
});

function severity(band: QuotaBand): number {
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
  return band === "critical" && now - prev.lastEmit >= CRITICAL_REMIND_MS;
}

export function buildSteerMessage(
  band: QuotaBand,
  codexState: string,
  fiveHourPct: number | undefined,
  sevenDayPct: number | undefined,
): string {
  const marker = `[quota:${band}]`;
  const usage = `${formatPct("5h", fiveHourPct)}, ${formatPct("7d", sevenDayPct)}`;
  const codexAvailable = codexState === CODEX_AVAILABLE;

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
  const raw = await readState<unknown>(RATE_LIMITS_CACHE_FILE, null);
  const parsed = RateLimitsCacheSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function writeRateLimitsCache(cache: RateLimitsCache): Promise<void> {
  await writeState(RATE_LIMITS_CACHE_FILE, cache);
}

export async function readQuotaSteerState(): Promise<QuotaSteerState | null> {
  const raw = await readState<unknown>(QUOTA_STEER_STATE_FILE, null);
  const parsed = QuotaSteerStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function writeQuotaSteerState(state: QuotaSteerState): Promise<void> {
  await writeState(QUOTA_STEER_STATE_FILE, state);
}
