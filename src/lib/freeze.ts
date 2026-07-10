// Edit-scope lock ("/freeze"). When a freeze boundary is set, the freeze-guard
// PreToolUse hook blocks Edit/Write to any file outside that directory
// — a deliberate guardrail for debugging or scoping a parallel agent to one
// module. State lives in ~/.claude/tmp/freeze.json so it persists across tool
// calls within a session.
//
// The state is keyed to the session that set it (CLAUDE_CODE_SESSION_ID —
// mirrors the session_id Claude Code passes to hooks). Without this, a freeze
// left on in one session/project silently blocks every edit in the next one,
// machine-wide, until someone finds and deletes the stale file. See
// getActiveFreeze for the self-healing check.

import { resolve, sep } from "node:path";
import { readState, writeState } from "./hook-runtime.ts";

export const FREEZE_STATE = "freeze.json";

export interface FreezeState {
  /** Absolute boundary directory, or null when no freeze is active. */
  root: string | null;
  /** Session id that set the boundary, or null (no freeze active, or the
   *  state file predates this field). Compared against the current session's
   *  id by getActiveFreeze to detect a stale, forgotten freeze. */
  sessionId: string | null;
}

const NO_FREEZE: FreezeState = { root: null, sessionId: null };

export async function readFreeze(): Promise<FreezeState> {
  const state = await readState<Partial<FreezeState>>(FREEZE_STATE, NO_FREEZE);
  // Back-compat: freeze.json written before this field existed only has `root`.
  return { root: state.root ?? null, sessionId: state.sessionId ?? null };
}

export async function writeFreeze(
  root: string | null,
  sessionId: string | null = null,
): Promise<void> {
  await writeState(FREEZE_STATE, { root, sessionId: root ? sessionId : null });
}

/** Resolve the freeze state that actually applies right now, self-healing a
 *  stale freeze away. A freeze boundary set by a different session — e.g.
 *  left on from a prior project and forgotten — must not silently block
 *  every edit next session. When the stored session id is known and differs
 *  from `currentSessionId`, treat the freeze as inactive and delete the state
 *  file. When `currentSessionId` is unavailable (older Claude Code build, or
 *  a caller that can't supply one) or the stored state predates session
 *  tagging, staleness can't be proven — the stored freeze is honored as-is,
 *  preserving prior behavior rather than silently disabling the guard. */
export async function getActiveFreeze(
  currentSessionId: string | null | undefined,
): Promise<FreezeState> {
  const state = await readFreeze();
  if (!state.root) return state;
  if (currentSessionId && state.sessionId && state.sessionId !== currentSessionId) {
    await writeFreeze(null, null);
    return NO_FREEZE;
  }
  return state;
}

/** Normalize a path to absolute (relative paths resolve against `cwd`). */
export function toAbsolute(p: string, cwd: string): string {
  return resolve(cwd, p);
}

/** Is `filePath` inside (or equal to) the freeze `root`? A null/empty root means
 *  no freeze is active, so everything is allowed. Both sides are resolved to
 *  absolute paths first, and the boundary match requires a path separator so that
 *  e.g. `/repo/src-extra` is NOT considered inside `/repo/src`. The separator is
 *  the platform's (`node:path` `sep`) — `resolve` emits `\` on Windows, so a
 *  hard-coded `/` would never match there and the check would reject everything. */
export function isWithinBoundary(filePath: string, root: string | null, cwd: string): boolean {
  if (!root) return true;
  const absRoot = resolve(cwd, root);
  const absFile = resolve(cwd, filePath);
  return absFile === absRoot || absFile.startsWith(`${absRoot}${sep}`);
}
