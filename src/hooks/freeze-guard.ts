#!/usr/bin/env bun
// Freeze Guard — PreToolUse hook. When a freeze boundary is active (set via the
// /freeze skill), blocks Edit/Write/MultiEdit targeting any file outside it.
//
// Decision protocol (matches safety-net.ts):
//   exit 0               → ALLOW (silent)
//   exit 2 + JSON stdout → BLOCK {"decision":"block","reason":"[Freeze] ..."}
// Fail-open: any unexpected error → allow (never break a tool call).
//
// Only Edit/Write/MultiEdit are gated (all carry `file_path`). NotebookEdit
// (notebook_path) and Bash writes are intentionally not covered.

import { isWithinBoundary, readFreeze } from "../lib/freeze.ts";

type EditLikeInput = { file_path?: string };

async function main(): Promise<void> {
  let parsed: EditLikeInput = {};
  try {
    parsed = JSON.parse(process.env.TOOL_INPUT ?? "{}") as EditLikeInput;
  } catch {
    return; // fail-open on bad JSON
  }

  const filePath = parsed.file_path;
  if (!filePath) return;

  const { root } = await readFreeze();
  if (isWithinBoundary(filePath, root, process.cwd())) return;

  process.stdout.write(
    `${JSON.stringify({
      decision: "block",
      reason:
        `[Freeze] ${filePath} is outside the freeze boundary (${root}). ` +
        "Only edits within the frozen directory are allowed. Lift it with: bun ~/.claude/src/scripts/freeze.ts off",
    })}\n`,
  );
  process.exit(2);
}

try {
  await main();
} catch {
  // fail-open — never break a tool call due to a hook error
}
