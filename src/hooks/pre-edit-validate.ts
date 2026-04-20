#!/usr/bin/env bun
// Pre-Edit Validation Hook — port of scripts/pre-edit-validate.sh.
//
// Fail-open: any unexpected error → exit 0 (allow the edit).
// Decision: exit 2 blocks the edit; exit 0 allows.
//
// Checks:
//   1. Target file exists.
//   2. old_string exists in the target file.
//   3. Warn on large old_string (>15 lines).
//   4. Warn on ambiguous old_string (>1 occurrence).

import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

type EditInput = {
  file_path?: string;
  old_string?: string;
};

async function main(): Promise<number> {
  const filePath = process.env.TOOL_INPUT_file_path ?? "";
  let parsed: EditInput = {};

  const toolInput = process.env.TOOL_INPUT;
  if (toolInput) {
    try {
      parsed = JSON.parse(toolInput) as EditInput;
    } catch {
      // fail-open on bad JSON
    }
  }

  const resolvedPath = filePath || parsed.file_path || "";
  if (!resolvedPath) return 0;

  // Check 1: file exists.
  try {
    const st = await stat(resolvedPath);
    if (!st.isFile()) {
      console.log(`[Harness] File does not exist: ${resolvedPath}`);
      console.log("[Harness] Use Write tool to create new files.");
      return 2;
    }
  } catch {
    console.log(`[Harness] File does not exist: ${resolvedPath}`);
    console.log("[Harness] Use Write tool to create new files.");
    return 2;
  }

  const oldString = parsed.old_string;
  if (!oldString) return 0;

  let content = "";
  try {
    content = await readFile(resolvedPath, "utf8");
  } catch {
    // fail-open on read error
    return 0;
  }

  const base = basename(resolvedPath);

  // Check 2: old_string exists in file.
  if (!content.includes(oldString)) {
    const firstLine = (oldString.split("\n")[0] ?? "").trim();
    if (firstLine && content.includes(firstLine)) {
      console.log(`[Harness] old_string not found as exact match in ${base}.`);
      console.log("[Harness] First line exists — likely whitespace or character mismatch.");
      console.log("[Harness] Re-read the file with Read tool, then retry.");
    } else {
      console.log(`[Harness] old_string not found in ${base}.`);
      console.log("[Harness] File may have changed since last read. Re-read before editing.");
    }
    console.log("[Harness] For complex edits, use Write tool for full file replacement.");
    return 2;
  }

  // Check 3: large old_string.
  const lineCount = (oldString.match(/\n/g)?.length ?? 0) + 1;
  if (lineCount > 15) {
    console.log(`[Harness] Large edit target (${lineCount} lines) in ${base}.`);
    console.log(
      "[Harness] Large string-replace edits are error-prone. Consider Write tool for full file replacement.",
    );
    return 0;
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
    return 0;
  }

  return 0;
}

process.exit(await main());
