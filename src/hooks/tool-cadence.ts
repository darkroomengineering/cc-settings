#!/usr/bin/env bun
// PostToolUse hook — tool-cadence nudges. Merge of two hooks that each ran
// unmatched on EVERY PostToolUse (two Bun spawns per tool call → one):
//
//   • parallelmax branch (was parallelmax-nudge.ts) — counts consecutive
//     non-Agent tool calls and tracked files; fires one soft nudge per streak
//     at THRESHOLD calls or FILES_THRESHOLD distinct file edits, then one
//     escalation (soft block via continueOnBlock) if the streak continues.
//   • review-queue branch (was review-queue-nudge.ts) — backpressure, the
//     consumer-side counterpart: counts Agent spawns since the last commit,
//     nudges at CC_MAX_UNREVIEWED, drains on successful commit/push,
//     reconciles when HEAD moves, and flags cognitive surrender (a deep
//     queue committed too fast) on commit.
//
// One stdin read feeds both branches. Each branch is individually fail-open
// (mirroring the formerly-separate processes), and the whole hook runs under
// runHook — any error → silent success, never break a tool call.

import { runGit } from "../lib/git.ts";
import { intEnv } from "../lib/hook-config.ts";
import {
  emitAdditionalContext,
  readHookInput,
  readState,
  runHook,
  writeState,
} from "../lib/hook-runtime.ts";
import {
  type BashResult,
  buildNudge,
  buildSurrenderNudge,
  commitSucceeded,
  isCognitiveSurrender,
  isGitCommit,
  isGitPush,
  isReviewableAgent,
  maxUnreviewed,
  minReviewSeconds,
  movesHead,
  onAgentSpawn,
  onCommit,
  onHeadObserved,
  pushSucceeded,
  type ReviewQueueState,
  ReviewQueueStateSchema,
  shouldNudge,
} from "../lib/review-queue.ts";

// Consecutive non-Agent tool calls before the delegation nudge fires.
// Env-overridable (CC_PARALLELMAX_THRESHOLD); default 20 — high enough that
// routine multi-step edits don't trip it, low enough to catch genuine
// "should have fanned out" runs. Raised from 12 (Aug 2026): every delegation
// spawns a fresh context that re-pays the system prompt, so the nudge should
// fire on genuinely large runs, not medium ones.
const THRESHOLD = intEnv("CC_PARALLELMAX_THRESHOLD", 20);
// Distinct file edits before the nudge fires (regardless of call count).
const FILES_THRESHOLD = 3;
const DEBOUNCE_MS = 60_000;
const COUNTER_STATE = "parallelmax-counter.json";
const QUEUE_STATE = "review-queue.json";

// File-edit tools and the field carrying the path in tool_input.
const FILE_EDIT_TOOLS: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  NotebookEdit: "notebook_path",
};

interface CounterState {
  count: number;
  lastTool: string;
  /** Debounce timestamp; genuinely absent until the first fire. */
  firedAt?: number;
  // The rest are always present once normalizeCounterState() has run.
  files: string[];
  nudged: boolean;
  countAtNudge: number;
  filesAtNudge: number;
  escalated: boolean;
}

type Payload = {
  tool_name: string;
  tool_input: {
    command?: string;
    subagent_type?: string;
    file_path?: string;
    notebook_path?: string;
  };
  tool_response: BashResult;
  cwd?: string;
};

/** Current HEAD SHA in `cwd`, or undefined if git can't be read (fail-soft). */
async function currentHead(cwd: string): Promise<string | undefined> {
  const out = (await runGit(["rev-parse", "HEAD"], { cwd })).trim();
  return out || undefined;
}

/** Read + validate review-queue.json the same way statusline.ts does (N2) —
 *  a corrupted/hand-edited state file degrades to the empty-queue default
 *  instead of feeding garbage into the arithmetic below. Never throws. */
async function readQueueState(): Promise<ReviewQueueState> {
  const raw = await readState<unknown>(QUEUE_STATE, null);
  const parsed = ReviewQueueStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : { awaiting: 0 };
}

/** Validate and default every field of CounterState from an unknown raw value.
 *  Replaces the previous inline re-hydration + `as number | undefined` cast. */
function normalizeCounterState(raw: unknown): CounterState {
  if (raw === null || typeof raw !== "object") {
    return {
      count: 0,
      lastTool: "",
      files: [],
      nudged: false,
      countAtNudge: 0,
      filesAtNudge: 0,
      escalated: false,
    };
  }
  const r = raw as Record<string, unknown>;
  return {
    count: typeof r.count === "number" ? r.count : 0,
    lastTool: typeof r.lastTool === "string" ? r.lastTool : "",
    firedAt: typeof r.firedAt === "number" ? r.firedAt : undefined,
    files: Array.isArray(r.files) ? (r.files as string[]) : [],
    nudged: typeof r.nudged === "boolean" ? r.nudged : false,
    countAtNudge: typeof r.countAtNudge === "number" ? r.countAtNudge : 0,
    filesAtNudge: typeof r.filesAtNudge === "number" ? r.filesAtNudge : 0,
    escalated: typeof r.escalated === "boolean" ? r.escalated : false,
  };
}

// --- Branch 1: consecutive non-Agent call counter --------------------------

async function parallelmaxBranch(
  toolName: string,
  toolInput: Payload["tool_input"],
): Promise<void> {
  const raw = await readState<unknown>(COUNTER_STATE, null);
  const state = normalizeCounterState(raw);

  if (toolName === "Agent") {
    // Reset the whole streak on delegation; preserve firedAt for debounce.
    await writeState(COUNTER_STATE, {
      count: 0,
      lastTool: toolName,
      firedAt: state.firedAt,
      files: [],
      nudged: false,
      countAtNudge: 0,
      filesAtNudge: 0,
      escalated: false,
    });
    return;
  }

  state.count += 1;
  state.lastTool = toolName;

  // Track file edits (deduplicated, capped at the 20 MOST RECENT — slice(-20),
  // not slice(0, 20), so the tracked set keeps rolling forward instead of
  // freezing on the first 20 files ever seen in the streak).
  const filePathField = FILE_EDIT_TOOLS[toolName];
  if (filePathField) {
    const fp = toolInput[filePathField as keyof typeof toolInput];
    if (typeof fp === "string" && fp && !state.files.includes(fp)) {
      state.files = [...state.files, fp].slice(-20);
    }
  }

  const now = Date.now();
  const debounceOk = !state.firedAt || now - state.firedAt >= DEBOUNCE_MS;

  // --- Soft nudge (at most once per streak) ---------------------------------
  if (
    !state.nudged &&
    (state.count >= THRESHOLD || state.files.length >= FILES_THRESHOLD) &&
    debounceOk
  ) {
    const rq = await readQueueState();
    if (rq.awaiting < maxUnreviewed()) {
      state.nudged = true;
      state.countAtNudge = state.count;
      state.filesAtNudge = state.files.length;
      state.firedAt = now;
    }
  }

  await writeState(COUNTER_STATE, state);
}

// --- Branch 2: review-queue backpressure ------------------------------------

async function reviewQueueBranch(payload: Partial<Payload>, toolName: string): Promise<void> {
  if (toolName === "Bash") {
    const command = payload.tool_input?.command ?? "";
    if (!command) return;
    const cwd = payload.cwd ?? process.cwd();

    // Drain: a SUCCESSFUL commit closes the loop. A failed commit (nothing to
    // commit, a rejecting pre-commit hook, a blocked merge) must not reset the
    // queue. Run the cognitive-surrender check on the pre-reset state, then reset.
    if (isGitCommit(command) && commitSucceeded(payload.tool_response)) {
      const state = await readQueueState();
      const now = Date.now();
      if (isCognitiveSurrender(state, now, maxUnreviewed(), minReviewSeconds() * 1000)) {
        const dwellSeconds = Math.round((now - (state.firstSpawnAt ?? now)) / 1000);
        emitAdditionalContext("PostToolUse", buildSurrenderNudge(state.awaiting, dwellSeconds));
      }
      await writeState(QUEUE_STATE, onCommit(await currentHead(cwd)));
      return;
    }

    // Drain: a successful push sent the work off for review/CI — a clean
    // "I'm done with this batch" boundary.
    if (isGitPush(command) && pushSucceeded(payload.tool_response)) {
      await writeState(QUEUE_STATE, onCommit(await currentHead(cwd)));
      return;
    }

    // Reconcile: pull/merge/rebase/reset/checkout/switch can advance HEAD past
    // our baseline without a Claude commit (ff-pull, pulled-down PR merge).
    // Draining only happens when HEAD actually changed (see onHeadObserved).
    if (movesHead(command)) {
      const state = await readQueueState();
      await writeState(QUEUE_STATE, onHeadObserved(state, await currentHead(cwd)));
      return;
    }

    return;
  }

  // Producer: every agent spawned is one more unit awaiting review — except
  // read-only agents (explore, oracle, …) that leave no diff to commit.
  if (toolName !== "Agent") return;
  if (!isReviewableAgent(payload.tool_input?.subagent_type)) return;

  const now = Date.now();
  const next = onAgentSpawn(await readQueueState(), now);
  const max = maxUnreviewed();

  if (shouldNudge(next, max, now)) {
    emitAdditionalContext("PostToolUse", buildNudge(next.awaiting, max));
    next.firedAt = now;
  }

  await writeState(QUEUE_STATE, next);
}

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  const payload = await readHookInput<Payload>({ tool_name: "TOOL_NAME" });
  const toolName = payload.tool_name ?? "";

  // Branch isolation: a crash in one branch must not silence the other —
  // before the merge these were separate processes. reviewQueueBranch runs
  // first because parallelmaxBranch may end the process via blockDecision()
  // on escalation; the review-queue state must already be written by then.
  try {
    await reviewQueueBranch(payload, toolName);
  } catch {
    // fail open
  }
  try {
    await parallelmaxBranch(toolName, payload.tool_input ?? {});
  } catch {
    // fail open
  }
}

await runHook(main);
