#!/usr/bin/env bun
// PostToolUse async hook — runs tsc --noEmit and surfaces errors for the edited file.
// Port of scripts/post-edit-tsc.sh.
//
// Fires only for .ts/.tsx files, only when a tsconfig.json exists in cwd.
// Never fails the hook: errors are stdout-only. Fail-open if bunx is missing
// or tsc itself crashes — diagnostic, not a guard rail.

import { existsSync } from "node:fs";
import { relative } from "node:path";
import { runTsc } from "../lib/tsc.ts";

try {
  const filePath = process.env.TOOL_INPUT_file_path ?? "";
  if (filePath && /\.tsx?$/.test(filePath) && existsSync("tsconfig.json")) {
    // Run tsc, filter to lines mentioning the edited file. Bash version used:
    //   bunx tsc --noEmit 2>&1 | grep -E "$FILE_PATH" || true
    const { combined } = await runTsc();
    // tsc prints diagnostics with paths relative to cwd ("src/lib/foo.ts(1,2):
    // error TS...") but Claude Code passes TOOL_INPUT_file_path as an absolute
    // path. Matching only the absolute form silently matched nothing, so the
    // hook burned a full typecheck per edit and never reported anything.
    // Match either form; substring matching avoids escaping the path as regex.
    const rel = relative(process.cwd(), filePath);
    const candidates = [filePath, rel].filter(Boolean);
    const matches = combined
      .split(/\r?\n/)
      .filter((line) => line && candidates.some((candidate) => line.includes(candidate)))
      .join("\n");

    if (matches) console.log(matches);
  }
} catch {
  // fail-open: tsc run failed (bunx missing, OOM, etc.) — silent skip
}
