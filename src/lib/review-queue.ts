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
// Pure logic only (no I/O) so it's unit-testable; review-queue-nudge.ts wraps it.

export interface ReviewQueueState {
  /** Agent tool calls since the last commit. */
  awaiting: number;
  /** Epoch ms of the last nudge — debounce so we don't nag on every spawn. */
  firedAt?: number;
}

export const DEBOUNCE_MS = 60_000;
const DEFAULT_MAX = 5;

/** Review-rate threshold from CC_MAX_UNREVIEWED (default 5). Non-positive or
 *  unparseable values fall back to the default. */
export function maxUnreviewed(): number {
  const raw = process.env.CC_MAX_UNREVIEWED;
  if (raw === undefined) return DEFAULT_MAX;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX;
}

/** An agent spawned — one more unit of work awaiting your review. */
export function onAgentSpawn(state: ReviewQueueState): ReviewQueueState {
  return { ...state, awaiting: state.awaiting + 1 };
}

/** A commit closed the loop — reset the queue (and the debounce). */
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

export function buildNudge(count: number, max: number): string {
  return (
    `You've spawned ${count} agents since your last commit (review queue ≥ ${max}). ` +
    `Your review throughput is the bottleneck, not agent count — adding more agents just ` +
    `deepens the queue in front of the one serial resource (you). Close the loop on what's ` +
    `already done (review + commit) before fanning out further. Threshold: CC_MAX_UNREVIEWED. ` +
    `(The Orchestration Tax.)`
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
