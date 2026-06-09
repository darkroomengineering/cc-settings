#!/usr/bin/env bun
// Pre-Edit Validation Hook — port of scripts/pre-edit-validate.sh.
//
// Decision protocol (shared with safety-net.ts / freeze-guard.ts via
// lib/hook-runtime.ts blockDecision):
//   exit 0               → ALLOW (stdout may carry advisory [Harness] warnings)
//   exit 2 + JSON stdout → BLOCK {"decision":"block","reason":"[Harness] ..."}
//
// Fail-open: any unexpected error → exit 0 (allow the edit), and unparseable
// TOOL_INPUT never blocks (readToolInputEnv returns {}).
//
// Checks:
//   1. Target file exists.                           (block)
//   2. old_string exists in the target file.         (block)
//   3. Warn on large old_string (>15 lines).         (advisory, exit 0)
//   4. Warn on ambiguous old_string (>1 occurrence). (advisory, exit 0)

import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { blockDecision, readToolInputEnv } from "../lib/hook-runtime.ts";

type EditInput = {
  file_path?: string;
  old_string?: string;
};

async function main(): Promise<void> {
  // Claude Code passes the Edit tool input as a JSON blob in TOOL_INPUT; both
  // file_path and old_string are read from it. (The per-field TOOL_INPUT_*
  // scalars carry the same data — one source avoids the file_path/old_string
  // asymmetry.)
  const parsed = readToolInputEnv<EditInput>();

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
    blockDecision(
      `[Harness] File does not exist: ${resolvedPath}. Use Write tool to create new files.`,
    );
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
    blockDecision(`${diagnosis} For complex edits, use Write tool for full file replacement.`);
  }

  // Check 3: large old_string.
  const lineCount = (oldString.match(/\n/g)?.length ?? 0) + 1;
  if (lineCount > 15) {
    console.log(`[Harness] Large edit target (${lineCount} lines) in ${base}.`);
    console.log(
      "[Harness] Large string-replace edits are error-prone. Consider Write tool for full file replacement.",
    );
    return;
  }

  // Check 4: ambiguous old_string.
  let occurrences = 0;
  let searchFrom = 0;
  while (true) {
    const found = content.indexOf(oldString, searchFrom);
    if (found === -1) break;
    occurrences++;
    searchFrom = found + oldString.length;
  }
  if (occurrences > 1) {
    console.log(`[Harness] old_string appears ${occurrences} times in ${base}.`);
    console.log(
      "[Harness] Add more surrounding context to make old_string unique, or use replace_all.",
    );
  }
}

try {
  await main();
} catch {
  // Fail-open: an unexpected throw must never block the edit. Intentional
  // blocks exit(2) inside blockDecision and never reach this catch.
}
