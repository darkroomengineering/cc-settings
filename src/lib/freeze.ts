// Edit-scope lock ("/freeze"). When a freeze boundary is set, the freeze-guard
// PreToolUse hook blocks Edit/Write to any file outside that directory
// — a deliberate guardrail for debugging or scoping a parallel agent to one
// module. State lives in a session-specific file under ~/.claude/tmp so it
// persists across tool calls without overwriting another session's boundary.
//
// The state is keyed to the session that set it (CLAUDE_CODE_SESSION_ID —
// mirrors the session_id Claude Code passes to hooks). Without this, a freeze
// left on in one session/project silently blocks every edit in the next one,
// machine-wide, until someone finds and deletes the stale file. See
// getActiveFreeze for legacy state handling.

import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { readState, writeState } from "./hook-runtime.ts";

export const FREEZE_STATE = "freeze.json";

export interface FreezeState {
  /** Absolute boundary directory, or null when no freeze is active. */
  root: string | null;
  /** Session id that owns the boundary, or null when session tagging is
   *  unavailable. Legacy records apply only to their owner when known. */
  sessionId: string | null;
}

const NO_FREEZE: FreezeState = { root: null, sessionId: null };

function stateFile(sessionId: string | null | undefined): string {
  return sessionId
    ? `freeze-${createHash("sha256").update(sessionId).digest("hex")}.json`
    : FREEZE_STATE;
}

export async function writeFreeze(
  root: string | null,
  sessionId: string | null = null,
): Promise<void> {
  await writeState(stateFile(sessionId), { root, sessionId });
}

/** Read this session's boundary, falling back to legacy state. Foreign legacy
 *  state is ignored without deleting another session's boundary. Untagged legacy
 *  state remains enforced when ownership cannot be established. A session's
 *  explicit cleared record prevents the fallback from reactivating a freeze. */
export async function getActiveFreeze(
  currentSessionId: string | null | undefined,
): Promise<FreezeState> {
  const scoped = currentSessionId
    ? await readState<Partial<FreezeState> | null>(stateFile(currentSessionId), null)
    : null;
  const raw = scoped ?? (await readState<Partial<FreezeState>>(FREEZE_STATE, NO_FREEZE));
  // Back-compat: freeze.json written before this field existed only has `root`.
  const state: FreezeState = { root: raw.root ?? null, sessionId: raw.sessionId ?? null };
  if (!state.root) return state;
  if (currentSessionId && state.sessionId && state.sessionId !== currentSessionId) {
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
