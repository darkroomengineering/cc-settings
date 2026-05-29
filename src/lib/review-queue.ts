// Review-queue backpressure — the consumer-side counterpart to parallelmax-nudge.
//
// The producer-side hooks (delegation-detector, parallelmax-nudge) push toward
// spawning MORE agents. This models the constraint the "Orchestration Tax"
// essay names: human review throughput. We count agent spawns since the last
// commit and nudge when that exceeds your review rate (CC_MAX_UNREVIEWED).
//
// Drain model: a `git commit` resets the counter — committing means you
// reviewed + integrated the work. It's a heuristic (commits and agents aren't
// 1:1), but a clear, interpretable signal: "agents spawned since you last
// closed a loop". Unlike parallelmax's consecutive-call counter, the count is
// NOT reset on nudge — a queue's depth is real and keeps growing until drained.
//
// v2 adds the "tax meter": the age of the oldest unreviewed work (surfaced in
// the statusline) and a cognitive-surrender proxy — committing a deep queue
// faster than a real review could plausibly take is flagged on commit.
//
// Pure logic only (no I/O) so it's unit-testable; review-queue-nudge.ts wraps it.

export interface ReviewQueueState {
  /** Agent tool calls since the last commit. */
  awaiting: number;
  /** Epoch ms of the FIRST spawn since the last commit (oldest unreviewed work). */
  firstSpawnAt?: number;
  /** Epoch ms of the last nudge — debounce so we don't nag on every spawn. */
  firedAt?: number;
}

export const DEBOUNCE_MS = 60_000;
const DEFAULT_MAX = 5;
const DEFAULT_MIN_REVIEW_S = 60;

/** Review-rate threshold from CC_MAX_UNREVIEWED (default 5). Non-positive or
 *  unparseable values fall back to the default. */
export function maxUnreviewed(): number {
  return positiveIntEnv("CC_MAX_UNREVIEWED", DEFAULT_MAX);
}

/** Minimum plausible review time per queue from CC_MIN_REVIEW_SECONDS (default
 *  60). Committing a queue at/over the threshold faster than this is flagged as
 *  likely cognitive surrender (rubber-stamping). */
export function minReviewSeconds(): number {
  return positiveIntEnv("CC_MIN_REVIEW_SECONDS", DEFAULT_MIN_REVIEW_S);
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** An agent spawned — one more unit of work awaiting your review. Stamps the
 *  oldest-unreviewed marker when the queue was empty. */
export function onAgentSpawn(state: ReviewQueueState, now: number): ReviewQueueState {
  return {
    ...state,
    awaiting: state.awaiting + 1,
    firstSpawnAt: state.awaiting === 0 ? now : state.firstSpawnAt,
  };
}

/** A commit closed the loop — reset the queue (and the markers). */
export function onCommit(): ReviewQueueState {
  return { awaiting: 0 };
}

/** Nudge when the queue is at/over the review rate and we haven't nudged
 *  within DEBOUNCE_MS. */
export function shouldNudge(state: ReviewQueueState, max: number, now: number): boolean {
  if (state.awaiting < max) return false;
  if (state.firedAt !== undefined && now - state.firedAt < DEBOUNCE_MS) return false;
  return true;
}

/** Age of the oldest unreviewed work in ms (0 if the queue is empty). */
export function ageMs(state: ReviewQueueState, now: number): number {
  if (state.awaiting === 0 || state.firstSpawnAt === undefined) return 0;
  return Math.max(0, now - state.firstSpawnAt);
}

/** Compact age label: "45s", "12m", "3h05m". */
export function formatAge(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h${m.toString().padStart(2, "0")}m`;
}

/** Cognitive-surrender proxy: a deep queue (≥ max) committed faster than a
 *  plausible review window. Evaluated on commit, BEFORE the reset. */
export function isCognitiveSurrender(
  state: ReviewQueueState,
  now: number,
  max: number,
  minReviewMs: number,
): boolean {
  if (state.awaiting < max) return false;
  if (state.firstSpawnAt === undefined) return false;
  return now - state.firstSpawnAt < minReviewMs;
}

export function buildNudge(count: number, max: number): string {
  return (
    `You've spawned ${count} agents since your last commit (review queue ≥ ${max}). ` +
    `Your review throughput is the bottleneck, not agent count — adding more agents just ` +
    `deepens the queue in front of the one serial resource (you). Close the loop on what's ` +
    `already done (review + commit) before fanning out further. Threshold: CC_MAX_UNREVIEWED. ` +
    `(The Orchestration Tax.)`
  );
}

export function buildSurrenderNudge(count: number, dwellSeconds: number): string {
  return (
    `You just committed ${count} agents' work ~${dwellSeconds}s after the first spawn — ` +
    `faster than a real review of that much output plausibly takes. If you genuinely read ` +
    `it, ignore this; if you rubber-stamped because forming an opinion cost attention you ` +
    `didn't have, that's the cognitive-surrender failure mode — the tax getting paid as ` +
    `silently-lowered standards. Threshold: CC_MIN_REVIEW_SECONDS. (The Orchestration Tax.)`
  );
}

/** Does this Bash command perform a `git commit`? Matches `git … commit`
 *  (including `git -C x commit`, `git commit --amend`, `… && git commit -m`)
 *  but not `git commit-graph`, `git log`, or `--no-commit`. Intentionally
 *  simple; a missed/spurious reset only mis-times a backpressure nudge. */
export function isGitCommit(cmd: string): boolean {
  if (!/\bgit\b/.test(cmd)) return false;
  if (/--no-commit\b/.test(cmd)) return false;
  return /\bgit\b[^|&;]*\bcommit\b(?!-)/.test(cmd);
}
