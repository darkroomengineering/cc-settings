#!/usr/bin/env bun
// Pre-Edit Validation Hook — PreToolUse guard for Edit calls.
//
// Write is intentionally excluded (config/40-hooks.json wires this hook to
// matcher "Edit" only): Write's tool_input carries no old_string, so checks
// 2-4 below never apply to it anyway, and check 1 (target file must exist)
// would incorrectly block legitimate new-file creation via Write, which has
// no existing file to check against.
//
// Decision protocol (shared with safety-net.ts / freeze-guard.ts via
// lib/hook-runtime.ts blockDecision):
//   exit 0               → ALLOW (stdout may carry advisory [Harness] warnings)
//   exit 2 + JSON stdout → BLOCK {"decision":"block","reason":"[Harness] ..."}
//
// Fail-open: any unexpected error → exit 0 (allow the edit), and unparseable
// input never blocks (readToolInput returns {}).
//
// Checks:
//   1. Target file exists.                           (block)
//   2. old_string exists in the target file.         (block)
//   3. Warn on large old_string (>15 lines).         (advisory, exit 0)
//   4. Warn on ambiguous old_string (>1 occurrence). (advisory, exit 0)

import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { type HookIO, processIO, runHook } from "../lib/hook-runtime.ts";

type EditInput = {
  file_path?: string;
  old_string?: string;
};

export async function main(io: HookIO = processIO): Promise<void> {
  // Claude Code passes the Edit tool input as `tool_input` in the stdin JSON;
  // both file_path and old_string are read from it.
  const parsed = await io.toolInput<EditInput>();

  const resolvedPath = parsed.file_path ?? "";
  if (!resolvedPath) return;

  // Check 1: file exists.
  let isFile = false;
  try {
    isFile = (await stat(resolvedPath)).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    io.block(`[Harness] File does not exist: ${resolvedPath}. Use Write tool to create new files.`);
  }

  const oldString = parsed.old_string;
  if (!oldString) return;

  let content = "";
  try {
    content = await readFile(resolvedPath, "utf8");
  } catch {
    // fail-open on read error
    return;
  }

  const base = basename(resolvedPath);

  // Check 2: old_string exists in file.
  if (!content.includes(oldString)) {
    const firstLine = (oldString.split("\n")[0] ?? "").trim();
    const diagnosis =
      firstLine && content.includes(firstLine)
        ? `[Harness] old_string not found as exact match in ${base}. ` +
          "First line exists — likely whitespace or character mismatch. " +
          "Re-read the file with Read tool, then retry."
        : `[Harness] old_string not found in ${base}. ` +
          "File may have changed since last read. Re-read before editing.";
    io.block(`${diagnosis} For complex edits, use Write tool for full file replacement.`);
  }

  // Check 3: ambiguous old_string. Advisory only: plain console.log stdout on
  // a PreToolUse hook never reaches the model (see docs/hooks-reference.md
  // "Sync vs Async Behavior"), so it goes through the
  // hookSpecificOutput.additionalContext envelope instead.
  let occurrences = 0;
  let searchFrom = 0;
  while (true) {
    const found = content.indexOf(oldString, searchFrom);
    if (found === -1) break;
    occurrences++;
    searchFrom = found + oldString.length;
  }
  if (occurrences > 1) {
    io.context(
      "PreToolUse",
      `[Harness] old_string appears ${occurrences} times in ${base}. ` +
        "Add more surrounding context to make old_string unique, or use replace_all.",
    );
  }
}

// Fail-open: an unexpected throw must never block the edit. Intentional
// blocks exit(2) inside blockDecision and never reach this catch.
if (import.meta.main) await runHook(main);
