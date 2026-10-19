#!/usr/bin/env bun
// Freeze Guard — PreToolUse hook. When a freeze boundary is active (set via the
// /freeze skill), blocks Edit/Write targeting any file outside it.
//
// Decision protocol (shared with safety-net.ts / pre-edit-validate.ts via
// lib/hook-runtime.ts blockDecision):
//   exit 0               → ALLOW (silent)
//   exit 2 + JSON stdout → BLOCK {"decision":"block","reason":"[Freeze] ..."}
// Fail-open: any unexpected error → allow (never break a tool call), and
// unparseable input never blocks (readToolInput returns {}).
//
// Only Edit/Write are gated (all carry `file_path`). NotebookEdit
// (notebook_path) and Bash writes are intentionally not covered.
//
// Session scoping: the freeze boundary is keyed to the session that set it,
// so a freeze forgotten from a different session/project self-heals away
// instead of silently blocking every edit here — see lib/freeze.ts
// getActiveFreeze. The current session id arrives on stdin JSON (the field
// Claude Code passes to hooks); CLAUDE_CODE_SESSION_ID is the env fallback
// (mirrors the same value, set automatically) for builds that don't deliver
// it that way — same fallback pattern as delegation-detector.ts.

import { getActiveFreeze, isWithinBoundary } from "../lib/freeze.ts";
import { type HookIO, processIO, runHook } from "../lib/hook-runtime.ts";

type EditLikeInput = { file_path?: string };

export async function main(io: HookIO = processIO): Promise<void> {
  const parsed = await io.toolInput<EditLikeInput>();

  const filePath = parsed.file_path;
  if (!filePath) return;

  const { session_id: sessionId } = await io.hookInput<{ session_id: string }>({
    session_id: "CLAUDE_CODE_SESSION_ID",
  });

  const { root } = await getActiveFreeze(sessionId);
  if (isWithinBoundary(filePath, root, process.cwd())) return;

  io.block(
    `[Freeze] ${filePath} is outside the freeze boundary (${root}). ` +
      "Only edits within the frozen directory are allowed. Lift it with: bun ~/.claude/src/scripts/freeze.ts off",
  );
}

if (import.meta.main) await runHook(main);
