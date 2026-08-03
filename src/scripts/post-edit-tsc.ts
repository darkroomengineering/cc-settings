#!/usr/bin/env bun
// PostToolUse async hook — runs tsc --noEmit and surfaces errors for the edited file.
// Port of scripts/post-edit-tsc.sh.
//
// Fires only for .ts/.tsx files, only when a tsconfig.json exists in cwd.
// Never fails the hook: a tsc crash (bunx missing, OOM) is fail-open, silent.
//
// Delivery: plain console.log stdout on a PostToolUse hook is NEVER read by
// the model — verified against Claude Code 2.1.220 by a headless marker
// probe, replicated twice (see docs/hooks-reference.md "Sync vs Async
// Behavior"). `async: true` (how this hook is wired in config/40-hooks.json)
// does not change that: the probe's async-envelope case injected, so the
// diagnostics below are emitted via the hookSpecificOutput.additionalContext
// envelope, not raw stdout.

import { existsSync } from "node:fs";
import { relative } from "node:path";
import { emitAdditionalContext } from "../lib/hook-runtime.ts";
import { runTsc } from "../lib/tsc.ts";

// A broken file can produce many tsc diagnostic lines; injecting all of them
// into context on every edit doesn't scale. Bound to a readable slice.
const MAX_LINES = 20;

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
    // On Windows `relative` returns `src\lib\foo.ts` while tsc prints
    // `src/lib/foo.ts`, so neither the absolute nor the native-relative form
    // matched and the hook silently reported nothing — the same failure the
    // absolute-path fix above addressed, one separator later. Include the
    // forward-slash form too; it is identical to `rel` on POSIX.
    const rel = relative(process.cwd(), filePath);
    const candidates = [filePath, rel, rel.replaceAll("\\", "/")].filter(Boolean);
    const matchLines = combined
      .split(/\r?\n/)
      .filter((line) => line && candidates.some((candidate) => line.includes(candidate)));

    if (matchLines.length > 0) {
      const capped =
        matchLines.length > MAX_LINES
          ? `${matchLines.slice(0, MAX_LINES).join("\n")}\n...${matchLines.length - MAX_LINES} more`
          : matchLines.join("\n");
      emitAdditionalContext("PostToolUse", capped);
    }
  }
} catch {
  // fail-open: tsc run failed (bunx missing, OOM, etc.) — silent skip
}
