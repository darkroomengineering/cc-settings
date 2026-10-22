// Pure helpers + types for advisory fired-vs-acted telemetry. Originally
// built for the model-escalation advisory (see escalate-model.ts /
// escalate-acted.ts) and generalized here to also cover the delegation-
// detector advisory (see delegation-detector.ts). Mirrors escalate.ts's
// split: pure line construction and parsing here, IO (log append, state
// read/write) at the hook call sites.
//
// The Slack-thread thesis this whole feature answers is "advisories get
// ignored" — this module measures whether ours do. The log therefore
// carries NO sample text / prompt text / reasons (signature key, tool name,
// score, count only): it is cross-session and long-lived, unlike the
// per-session signature tally that legitimately needs the sample for
// context injection.
//
// Two advisories share ONE log (TELEMETRY_LOG) and one JSONL line shape
// family, distinguished by an `advisory` field. The escalate advisory
// predates this field entirely — every escalate line on disk (and every
// escalate line this module still writes) omits it, and the reader
// defaults a missing `advisory` to "escalate" for backward compat. The
// delegation advisory is the only one that ever writes `advisory:
// "delegation"` explicitly. Escalate's on-disk shape is otherwise UNCHANGED
// by this generalization — buildFiredEvent/buildActedEvent/parsePendingMarker
// keep their exact prior signatures and output.

import { join } from "node:path";
import { claudePath } from "./platform.ts";

export const TELEMETRY_LOG = join(claudePath("logs"), "escalate-telemetry.jsonl");

export type Advisory = "escalate" | "delegation";

/** State-file name (see hook-runtime.ts's readState/writeState) for the
 *  per-session pending marker escalate-model.ts writes on fire and
 *  escalate-acted.ts reads/clears. One marker per session — a new fire
 *  overwrites the old one, which makes the old fire unmatchable (never-acted)
 *  by design: under-counting acted is the accepted error direction. */
export function pendingStateName(sessionId: string): string {
  return `escalate-pending-${sessionId}`;
}

/** State-file name for the delegation advisory's per-session pending marker
 *  — same one-marker-per-session, new-fire-overwrites-old convention as
 *  pendingStateName above. */
export function delegationPendingStateName(sessionId: string): string {
  return `delegation-pending-${sessionId}`;
}

/** How long an Agent call may lag a fire and still count as "acted on" it.
 *  Past this window, an Agent call is unrelated activity, not a response to
 *  the advisory.
 *
 *  Latency semantics: PostToolUse observes an Agent call on COMPLETION, not
 *  spawn, so the elapsed time measured against this window (and the
 *  `latencyMs` recorded in escalate-acted.ts) is fire→completion, including
 *  the subagent's full runtime — not fire→decision. A promptly-spawned but
 *  long-running subagent can therefore blow this window on completion time
 *  alone and be recorded as never-acted. That is an under-count, the
 *  accepted error direction for this telemetry. */
export const ACTED_WINDOW_MS = 60 * 60_000;

/** Delegation's acted window is much shorter than escalate's 60 minutes:
 *  the delegation nudge tells the model to delegate the CURRENT turn's work
 *  right now, not at some point in the session, so an Agent call more than
 *  10 minutes later is ordinary activity, not a response to the nudge. */
export const DELEGATION_ACTED_WINDOW_MS = 10 * 60_000;

export type EscalateVariant = "fable-session" | "escalate";

export interface PendingMarker {
  sig: string;
  firedAt: number;
}

export interface DelegationPendingMarker {
  /** Join key carried into the eventual acted line's `at` field — see
   *  computeStats's (session, at) dedupe/match key for delegation. */
  at: number;
  /** Same value as `at`. Kept as a separate field (rather than reusing `at`
   *  for staleness too) so the marker's two roles — "join key for pairing"
   *  and "timestamp for staleness" — stay named distinctly, matching the
   *  escalate marker's sig/firedAt split even though delegation's values are
   *  numerically identical at write time. */
  firedAt: number;
}

export interface FiredEvent {
  t: string;
  session: string;
  kind: "fired";
  /** Omitted on every line this module writes for the escalate advisory —
   *  present only for backward-compat typing. Missing → "escalate" (see
   *  eventAdvisory). */
  advisory?: "escalate";
  sig: string;
  tool: string;
  count: number;
  variant: EscalateVariant;
}

export interface ActedEvent {
  t: string;
  session: string;
  kind: "acted";
  /** Same backward-compat note as FiredEvent.advisory. */
  advisory?: "escalate";
  sig: string;
  latencyMs: number;
  model: string | null;
}

export interface DelegationFiredEvent {
  t: string;
  session: string;
  kind: "fired";
  advisory: "delegation";
  /** Fire timestamp in ms (Date.now()) — also the marker's join key. */
  at: number;
  /** The breadth score that crossed delegation-detector's threshold.
   *  Integer only — never the matched phrase or prompt text. */
  score: number;
  /** Jev's delegation probability when it decided the fire (15.23.0+);
   *  absent when the regex decided. */
  jev?: number;
}

export interface DelegationActedEvent {
  t: string;
  session: string;
  kind: "acted";
  advisory: "delegation";
  /** Copied from the pending marker's `at` — the (session, at) join key
   *  computeStats uses to pair this with its fired line. */
  at: number;
  latencyMs: number;
}

export type TelemetryEvent = FiredEvent | ActedEvent | DelegationFiredEvent | DelegationActedEvent;

export function buildFiredEvent(params: {
  t: string;
  session: string;
  sig: string;
  tool: string;
  count: number;
  variant: EscalateVariant;
}): FiredEvent {
  return { kind: "fired", ...params };
}

export function buildActedEvent(params: {
  t: string;
  session: string;
  sig: string;
  latencyMs: number;
  model: string | null;
}): ActedEvent {
  return { kind: "acted", ...params };
}

export function buildDelegationFiredEvent(params: {
  t: string;
  session: string;
  at: number;
  score: number;
  jev?: number;
}): DelegationFiredEvent {
  return { kind: "fired", advisory: "delegation", ...params };
}

export function buildDelegationActedEvent(params: {
  t: string;
  session: string;
  at: number;
  latencyMs: number;
}): DelegationActedEvent {
  return { kind: "acted", advisory: "delegation", ...params };
}

/** Serialize one event to a newline-terminated JSONL line. */
export function toJsonLine(event: TelemetryEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/** True when `firedAt` is still inside the acted-detection window relative to
 *  `now`. Exported so both the hooks and their tests share one definition of
 *  "stale". `windowMs` defaults to the escalate advisory's window
 *  (ACTED_WINDOW_MS); escalate-acted.ts passes DELEGATION_ACTED_WINDOW_MS
 *  explicitly for the delegation marker. */
export function isWithinActedWindow(
  firedAt: number,
  now: number,
  windowMs: number = ACTED_WINDOW_MS,
): boolean {
  return now - firedAt <= windowMs;
}

/** Validate a raw pending-marker state value. Both a genuinely missing file
 *  (readState's fallback) and a marker cleared to `{}` land here as an
 *  object without a valid `sig`/`firedAt` pair, and both must read as "no
 *  marker" — the reader does not need to distinguish "never fired" from
 *  "already consumed". */
export function parsePendingMarker(raw: unknown): PendingMarker | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.sig !== "string" || typeof r.firedAt !== "number") return null;
  return { sig: r.sig, firedAt: r.firedAt };
}

/** Same contract as parsePendingMarker, for the delegation advisory's
 *  at/firedAt marker shape. */
export function parseDelegationPendingMarker(raw: unknown): DelegationPendingMarker | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.at !== "number" || typeof r.firedAt !== "number") return null;
  return { at: r.at, firedAt: r.firedAt };
}

function isEscalateFiredEvent(v: unknown): v is FiredEvent {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.kind === "fired" &&
    (r.advisory === undefined || r.advisory === "escalate") &&
    typeof r.t === "string" &&
    typeof r.session === "string" &&
    typeof r.sig === "string" &&
    typeof r.tool === "string" &&
    typeof r.count === "number" &&
    (r.variant === "fable-session" || r.variant === "escalate")
  );
}

function isEscalateActedEvent(v: unknown): v is ActedEvent {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.kind === "acted" &&
    (r.advisory === undefined || r.advisory === "escalate") &&
    typeof r.t === "string" &&
    typeof r.session === "string" &&
    typeof r.sig === "string" &&
    typeof r.latencyMs === "number" &&
    (r.model === null || typeof r.model === "string")
  );
}

function isDelegationFiredEvent(v: unknown): v is DelegationFiredEvent {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.kind === "fired" &&
    r.advisory === "delegation" &&
    typeof r.t === "string" &&
    typeof r.session === "string" &&
    typeof r.at === "number" &&
    typeof r.score === "number"
  );
}

function isDelegationActedEvent(v: unknown): v is DelegationActedEvent {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.kind === "acted" &&
    r.advisory === "delegation" &&
    typeof r.t === "string" &&
    typeof r.session === "string" &&
    typeof r.at === "number" &&
    typeof r.latencyMs === "number"
  );
}

/** Parse one JSONL line into a TelemetryEvent, or null on malformed JSON or
 *  an unrecognized/incomplete shape. Never throws — callers (escalate-stats.ts)
 *  skip a null rather than aborting the whole aggregation over one bad line. */
export function parseTelemetryLine(line: string): TelemetryEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (isEscalateFiredEvent(parsed)) return parsed;
  if (isEscalateActedEvent(parsed)) return parsed;
  if (isDelegationFiredEvent(parsed)) return parsed;
  if (isDelegationActedEvent(parsed)) return parsed;
  return null;
}

/** Fired/acted/act-rate/latency for one advisory in isolation. */
export interface AdvisoryStats {
  firedTotal: number;
  actedTotal: number;
  /** Percentage, e.g. 33.3 for 1/3. 0 when firedTotal is 0. */
  actRate: number;
  medianActedLatencyMs: number | null;
}

export interface EscalateStats extends AdvisoryStats {
  byVariant: Record<string, number>;
  /** Acted count keyed by model override; entries with no override group
   *  under "unknown" rather than being dropped. */
  byModel: Record<string, number>;
  /** The delegation advisory's own fired/acted/act-rate/latency, computed
   *  with the same honesty rules (dedupe both sides, acted requires a
   *  matching fired) but keyed on (session, at) instead of (session, sig) —
   *  see computeStats's comment. The top-level fields on this interface
   *  (firedTotal, actedTotal, actRate, medianActedLatencyMs, byVariant,
   *  byModel) keep meaning the ESCALATE advisory's numbers, unchanged from
   *  before this field existed — existing consumers reading those fields
   *  directly are unaffected. */
  delegation: AdvisoryStats;
}

function median(sortedAsc: number[]): number {
  const mid = Math.floor(sortedAsc.length / 2);
  const a = sortedAsc[mid - 1];
  const b = sortedAsc[mid];
  if (sortedAsc.length % 2 === 0 && a !== undefined && b !== undefined) return (a + b) / 2;
  return sortedAsc[mid] ?? 0;
}

function sessionSigKey(e: { session: string; sig: string }): string {
  return `${e.session} ${e.sig}`;
}

function sessionAtKey(e: { session: string; at: number }): string {
  return `${e.session} ${e.at}`;
}

/** Dedupe a list by a caller-supplied key, keeping the earliest-`t`
 *  occurrence. Used by computeStats's honesty guarantee — see the comment
 *  there. Generalized from a (session, sig)-only helper so the same dedupe
 *  logic serves escalate's (session, sig) key and delegation's (session, at)
 *  key without duplicating the sort/seen-map mechanics. */
function dedupeBy<T extends { t: string }>(items: T[], keyFn: (item: T) => string): T[] {
  const sorted = [...items].sort((a, b) => a.t.localeCompare(b.t));
  const seen = new Map<string, T>();
  for (const item of sorted) {
    const key = keyFn(item);
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

/** Aggregate a set of already-parsed telemetry events into report-ready
 *  totals, per advisory.
 *
 *  Honesty guarantee (applies independently to EACH advisory): `acted` is
 *  counted only when a deduped `fired` line with the same match key exists,
 *  and both sides are deduped first (earliest `t` wins). The match key is
 *  (session, sig) for escalate and (session, at) for delegation — matching
 *  each advisory's own pending-marker join field. This is a reader-side fix
 *  for two failure modes in escalate-acted.ts's non-atomic read/clear/append
 *  of the pending marker, deliberately left as-is there (see its comments),
 *  and the same two modes apply equally to the delegation marker since it
 *  follows the identical read/clear/append pattern:
 *    1. Double-consume race — two Agent calls completing concurrently can
 *       both observe and clear the same marker, each appending its own
 *       `acted` line for one `fired` event. Deduping `acted` by the match key
 *       collapses these back to one.
 *    2. Write-ordering skew — if the `fired` log append fails (e.g. disk
 *       full) after the marker write already landed, an `acted` line can
 *       exist with no corresponding `fired` line. Requiring a matching
 *       deduped `fired` before counting `acted` drops these orphans.
 *  Together these make each advisory's act-rate structurally <= 100%,
 *  independent of either failure mode. Fired-side dedupe additionally
 *  absorbs the (currently impossible, but here for defense) case of a
 *  duplicate `fired` write for one key — the once-per-key gate means any
 *  duplicate is noise, not a second real fire.
 *
 *  Backward compat: a line with no `advisory` field (every escalate line
 *  written before this field existed, and every escalate line this module
 *  still writes) is read as advisory "escalate" — see isEscalateFiredEvent/
 *  isEscalateActedEvent's `r.advisory === undefined` branch. */
export function computeStats(events: TelemetryEvent[]): EscalateStats {
  const escalateFiredRaw = events.filter(isEscalateFiredEvent);
  const escalateActedRaw = events.filter(isEscalateActedEvent);

  const fired = dedupeBy(escalateFiredRaw, sessionSigKey);
  const firedKeys = new Set(fired.map(sessionSigKey));
  const acted = dedupeBy(escalateActedRaw, sessionSigKey).filter((a) =>
    firedKeys.has(sessionSigKey(a)),
  );

  const byVariant: Record<string, number> = {};
  for (const f of fired) byVariant[f.variant] = (byVariant[f.variant] ?? 0) + 1;

  const byModel: Record<string, number> = {};
  for (const a of acted) {
    const key = a.model ?? "unknown";
    byModel[key] = (byModel[key] ?? 0) + 1;
  }

  const latencies = acted.map((a) => a.latencyMs).sort((a, b) => a - b);

  const delegationFiredRaw = events.filter(isDelegationFiredEvent);
  const delegationActedRaw = events.filter(isDelegationActedEvent);

  const dFired = dedupeBy(delegationFiredRaw, sessionAtKey);
  const dFiredKeys = new Set(dFired.map(sessionAtKey));
  const dActed = dedupeBy(delegationActedRaw, sessionAtKey).filter((a) =>
    dFiredKeys.has(sessionAtKey(a)),
  );
  const dLatencies = dActed.map((a) => a.latencyMs).sort((a, b) => a - b);

  const delegation: AdvisoryStats = {
    firedTotal: dFired.length,
    actedTotal: dActed.length,
    actRate: dFired.length === 0 ? 0 : (dActed.length / dFired.length) * 100,
    medianActedLatencyMs: dLatencies.length === 0 ? null : median(dLatencies),
  };

  return {
    firedTotal: fired.length,
    actedTotal: acted.length,
    actRate: fired.length === 0 ? 0 : (acted.length / fired.length) * 100,
    medianActedLatencyMs: latencies.length === 0 ? null : median(latencies),
    byVariant,
    byModel,
    delegation,
  };
}
