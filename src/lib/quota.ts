import { z } from "zod";
import type { CodexState } from "./codex.ts";
import { readValidatedState, writeState } from "./hook-runtime.ts";

export type QuotaBand = "normal" | "elevated" | "critical" | "exhausted";

const RateLimitWindowSchema = z.object({
  used_percentage: z.number().optional(),
  // Persisted entries are always strings (statusline.ts's cacheResetValue
  // stringifies before writing), but the field is parsed defensively as
  // string OR number below (resetsAtMs) — a number here is tolerated in case
  // a future write path or an older cache format skips that stringify step.
  resets_at: z.union([z.string(), z.number()]).optional(),
});

export type RateLimitWindow = z.infer<typeof RateLimitWindowSchema>;

// One session's own reading of the account-wide rate limits, as seen by the
// statusline render that wrote it. `updated_at` is THIS entry's write time —
// not to be confused with the top-level `updated_at` below, which is derived
// (see resolveRateLimits).
const SessionRateLimitsSchema = z.object({
  five_hour: RateLimitWindowSchema.optional(),
  seven_day: RateLimitWindowSchema.optional(),
  updated_at: z.number(),
});

export type SessionRateLimits = z.infer<typeof SessionRateLimitsSchema>;
export type SessionRateLimitsMap = Record<string, SessionRateLimits>;

/** Cap on remembered sessions in the `sessions` map, same recency-cap idiom
 *  as session-model.ts's SESSION_MODEL_MAP_CAP and version-delta.ts's
 *  SESSION_MAP_CAP — prevents unbounded growth from many short-lived
 *  concurrent workspaces. Pruned inline on every write (mergeSessionRateLimits)
 *  rather than via session-start.ts's age-based sweep: this is one JSON map,
 *  not a directory of per-session files, so pruning at the single write site
 *  is simpler and enforces the cap on every write instead of once per launch. */
export const RATE_LIMITS_SESSION_CAP = 50;

// Top-level `five_hour`/`seven_day`/`updated_at` are DERIVED (see
// resolveRateLimits) rather than "whoever wrote last" — kept for backward
// compatibility with Programa's ClaudeQuotaSnapshotParser (programa repo,
// Sources/ClaudeQuotaMonitor.swift), which reads exactly these three
// top-level keys and ignores unknown ones (JSONSerialization to
// [String: Any]). `sessions` is new and additive; Programa's parser never
// looks at it.
const RateLimitsCacheSchema = z.object({
  five_hour: RateLimitWindowSchema.optional(),
  seven_day: RateLimitWindowSchema.optional(),
  updated_at: z.number(),
  sessions: z.record(z.string(), SessionRateLimitsSchema).optional(),
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
  fiveHourResetsAt?: number | string,
  sevenDayResetsAt?: number | string,
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

/**
 * Set (or refresh) one session's rate-limits reading and prune the map to the
 * RATE_LIMITS_SESSION_CAP most recently updated entries. Pure — callers own
 * the state IO, same split as refreshSessionModelMap/refreshSessionInstallMap.
 */
export function mergeSessionRateLimits(
  sessions: SessionRateLimitsMap,
  sessionId: string,
  entry: SessionRateLimits,
): SessionRateLimitsMap {
  const next: SessionRateLimitsMap = { ...sessions, [sessionId]: entry };
  return Object.fromEntries(
    Object.entries(next)
      .sort((a, b) => b[1].updated_at - a[1].updated_at)
      .slice(0, RATE_LIMITS_SESSION_CAP),
  );
}

export interface ResolvedRateLimits {
  five_hour?: RateLimitWindow;
  seven_day?: RateLimitWindow;
  updated_at: number;
}

// `resets_at` normalised to epoch ms, tolerating the two shapes it's seen in:
// string epoch-seconds (the persisted shape — statusline.ts's cacheResetValue
// stringifies before writing) and number epoch-millis (defensive only —
// tolerate it in case a future write path skips that stringify step, same
// spirit as formatTimeToReset's tolerance for pre-v12 ISO strings). Getting
// the seconds/millis boundary wrong here silently reverts the whole fix below
// (an expired-seconds value read as millis is ~1000x in the future and would
// never be pruned), so it's pinned by a dedicated test.
function resetsAtMs(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  // Below ~1e11 is seconds (that boundary is year 5138); larger is already ms
  // — same heuristic as formatTimeToReset.
  return numeric < 1e11 ? numeric * 1000 : numeric;
}

/**
 * Core fix for the "stale reading looks fresh" bug: `updated_at` records when
 * a statusline render WROTE an entry, not when it OBSERVED the reading — a
 * session idle for days still re-renders its statusline and rewrites its
 * ancient reading with a brand-new `updated_at`, so by that test alone it
 * always looks fresh. That let a long-dead session's reading from an already
 * -expired window win the max-of-fresh comparison (observed in production:
 * eight sessions all "written" within 30 seconds, several holding readings
 * from 5-hour windows that had rolled over days earlier).
 *
 * `resets_at` is the real freshness signal — it's already in the payload and
 * already persisted, and it tells you which window a reading belongs to.
 * Per window (five_hour/seven_day), independently:
 *   1. Drop entries whose `resets_at` is missing or already `<= now` — that
 *      reading belongs to a window that has already rolled over and is
 *      meaningless now.
 *   2. Among survivors, keep only those whose `resets_at` equals the MAXIMUM
 *      surviving `resets_at`. An earlier-but-still-future `resets_at` is a
 *      reading of the previous window taken just before rollover; mixing
 *      windows together (the old behaviour) is what produced the bug above.
 *   3. Among those same-window entries, take the MAX `used_percentage` —
 *      within one window usage only rises, so the highest reading is the
 *      most recently observed truth.
 *
 * `updated_at`/`staleMs` is kept as a secondary guard (bounds map growth,
 * drops sessions that vanished entirely) but is no longer the primary
 * freshness test — see the seconds-old-yet-expired case above.
 *
 * Returns null when nothing survives for either window (fresh machine, first
 * run, or every known session's windows already rolled over) — callers MUST
 * treat that as "unknown" and inject/report nothing, never fall back to a
 * stale or default number that would misrepresent true usage.
 */
export function resolveRateLimits(
  sessions: SessionRateLimitsMap | undefined,
  now: number,
  staleMs: number = CACHE_STALE_MS,
): ResolvedRateLimits | null {
  const notStale = Object.values(sessions ?? {}).filter((s) => now - s.updated_at <= staleMs);
  if (notStale.length === 0) return null;

  const resolveWindow = (
    select: (s: SessionRateLimits) => RateLimitWindow | undefined,
  ): RateLimitWindow | undefined => {
    // Step 1 — drop expired/unparseable-reset entries (dead windows).
    const live: Array<{ window: RateLimitWindow; resetMs: number }> = [];
    for (const s of notStale) {
      const w = select(s);
      if (w?.used_percentage === undefined) continue;
      const resetMs = resetsAtMs(w.resets_at);
      if (resetMs === undefined || resetMs <= now) continue;
      live.push({ window: w, resetMs });
    }
    if (live.length === 0) return undefined;

    // Step 2 — keep only entries from the current (latest-resetting) window.
    const maxResetMs = Math.max(...live.map((e) => e.resetMs));
    const sameWindow = live.filter((e) => e.resetMs === maxResetMs);

    // Step 3 — max used_percentage wins among same-window entries.
    let best = sameWindow[0]?.window;
    for (const e of sameWindow) {
      if (best === undefined || (e.window.used_percentage ?? 0) > (best.used_percentage ?? 0)) {
        best = e.window;
      }
    }
    return best;
  };

  const five_hour = resolveWindow((s) => s.five_hour);
  const seven_day = resolveWindow((s) => s.seven_day);
  if (five_hour === undefined && seven_day === undefined) return null;

  return {
    five_hour,
    seven_day,
    updated_at: Math.max(...notStale.map((s) => s.updated_at)),
  };
}

export async function readQuotaSteerState(): Promise<QuotaSteerState | null> {
  return readValidatedState(QUOTA_STEER_STATE_FILE, QuotaSteerStateSchema, null);
}

export async function writeQuotaSteerState(state: QuotaSteerState): Promise<void> {
  await writeState(QUOTA_STEER_STATE_FILE, state);
}
