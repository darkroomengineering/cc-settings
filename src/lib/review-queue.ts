// Review-queue backpressure — the consumer-side counterpart to the parallelmax counter.
//
// The producer-side hooks (delegation-detector, tool-cadence parallelmax branch) push toward
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
// Pure logic only (no I/O) so it's unit-testable; tool-cadence.ts wraps it.

export interface ReviewQueueState {
  /** Agent tool calls since the last commit. */
  awaiting: number;
  /** Epoch ms of the FIRST spawn since the last commit (oldest unreviewed work). */
  firstSpawnAt?: number;
  /** Epoch ms of the last nudge — debounce so we don't nag on every spawn. */
  firedAt?: number;
  /** Git HEAD SHA recorded at the last drain/observation. When HEAD advances
   *  past this — a commit Claude didn't run (another terminal), a fast-forward
   *  pull, or a pulled-down PR merge — the queue drains even without a local
   *  `git commit` event. */
  lastHead?: string;
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

/** Agent types that cannot leave a working-tree diff, so spawning one adds
 *  nothing to review + commit. Conservative on purpose: only agents with no
 *  write/edit capability are listed. `reviewer` and `planner` CAN write (review
 *  notes, plan docs, ADRs) that you might commit, so they intentionally still
 *  count — under-counting real review debt is the failure we most want to avoid. */
export const READ_ONLY_AGENTS = new Set([
  "explore",
  "Explore",
  "oracle",
  "Plan",
  "security-reviewer",
]);

/** Does spawning this agent type produce work that lands in your diff? Unknown
 *  or omitted types default to the general-purpose agent (which can edit), so
 *  they count. */
export function isReviewableAgent(subagentType: string | undefined): boolean {
  if (!subagentType) return true;
  return !READ_ONLY_AGENTS.has(subagentType);
}

/** The relevant slice of a Bash tool_response on PostToolUse. There is no
 *  exit-code field — a non-zero exit surfaces only as `is_error` on the wrapping
 *  tool_result block, which hooks don't receive — so commit success is inferred
 *  from output instead (see commitSucceeded). */
export interface BashResult {
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
}

/** Git prints a `[branch abcdef0] subject` summary on a SUCCESSFUL commit —
 *  including --amend, root, merge, and detached-HEAD commits. It is not
 *  localized, so it's a reliable positive signal, and it's absent on the three
 *  common failures that must NOT drain the queue: "nothing to commit", a
 *  rejecting pre-commit hook, and a blocked merge. Only consulted for commands
 *  already classified by isGitCommit, so false positives are near-impossible.
 *  Caveat: `git commit -q` prints nothing, so a quiet commit won't drain — a
 *  deliberate fail-safe (keep backpressure up rather than clear it unverified). */
const COMMIT_SUMMARY = /\[.+\s[0-9a-f]{7,40}\]/;

export function commitSucceeded(result: BashResult | undefined): boolean {
  if (!result || result.interrupted) return false;
  return COMMIT_SUMMARY.test(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
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

/** A commit closed the loop — reset the queue (and the markers). Records the
 *  post-commit HEAD as the new baseline when known, so the subsequent push of
 *  the same commit is a no-op rather than a spurious re-drain. */
export function onCommit(head?: string): ReviewQueueState {
  return head ? { awaiting: 0, lastHead: head } : { awaiting: 0 };
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

/** Does this Bash command perform a `git push`? Mirrors isGitCommit's
 *  intentionally-simple shape. Excludes `--dry-run` (sends nothing). */
export function isGitPush(cmd: string): boolean {
  if (!/\bgit\b/.test(cmd)) return false;
  if (/--dry-run\b/.test(cmd)) return false;
  return /\bgit\b[^|&;]*\bpush\b/.test(cmd);
}

/** A push that wasn't interrupted, shows a positive ref-update signal, and no
 *  failure marker. Git writes push results to stderr: success prints a `->`
 *  ref line, `[new branch]`/`[new tag]`, or "Everything up-to-date"; failure
 *  prints "rejected"/"fatal:"/"error:"/"failed to push". A looser bar than
 *  commitSucceeded — a push is a weaker review boundary and the cost of a
 *  false drain is only a mis-timed nudge. */
const PUSH_SUCCESS = /(->|\[new branch\]|\[new tag\]|Everything up-to-date)/;
const PUSH_FAILURE = /\b(rejected|fatal:|error:|failed to push)\b/i;
export function pushSucceeded(result: BashResult | undefined): boolean {
  if (!result || result.interrupted) return false;
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (PUSH_FAILURE.test(text)) return false;
  return PUSH_SUCCESS.test(text);
}

/** A git subcommand that can move HEAD without a Claude `git commit` event:
 *  pull/merge/rebase/reset/checkout/switch/cherry-pick/am/revert. Used to
 *  decide when to reconcile HEAD. Deliberately excludes status/log/diff/push
 *  (push is handled separately) so we don't run git on every status check. */
const HEAD_MOVING =
  /\bgit\b[^|&;]*\b(pull|merge|rebase|reset|checkout|switch|cherry-pick|am|revert)\b/;
export function movesHead(cmd: string): boolean {
  if (!/\bgit\b/.test(cmd)) return false;
  return HEAD_MOVING.test(cmd);
}

/** Reconcile the queue against the real git HEAD. The first observation only
 *  records a baseline (we can't tell if work advanced). Afterwards, a changed
 *  HEAD means committed work advanced by SOME path → drain. An unreadable HEAD
 *  (no repo / git failure → undefined) leaves the queue untouched. */
export function onHeadObserved(
  state: ReviewQueueState,
  head: string | undefined,
): ReviewQueueState {
  if (!head) return state;
  if (state.lastHead === undefined) return { ...state, lastHead: head };
  if (state.lastHead === head) return state;
  return { awaiting: 0, lastHead: head };
}
