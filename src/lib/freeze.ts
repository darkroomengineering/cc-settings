// Edit-scope lock ("/freeze"). When a freeze boundary is set, the freeze-guard
// PreToolUse hook blocks Edit/Write/MultiEdit to any file outside that directory
// — a deliberate guardrail for debugging or scoping a parallel agent to one
// module. State lives in ~/.claude/tmp/freeze.json so it persists across tool
// calls within a session.

import { resolve, sep } from "node:path";
import { readState, writeState } from "./hook-runtime.ts";

export const FREEZE_STATE = "freeze.json";

export interface FreezeState {
  /** Absolute boundary directory, or null when no freeze is active. */
  root: string | null;
}

export async function readFreeze(): Promise<FreezeState> {
  return readState<FreezeState>(FREEZE_STATE, { root: null });
}

export async function writeFreeze(root: string | null): Promise<void> {
  await writeState(FREEZE_STATE, { root });
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
