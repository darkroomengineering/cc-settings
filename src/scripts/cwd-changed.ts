#!/usr/bin/env bun
// CwdChanged hook — re-surface project context when the user jumps repos mid-session.
// Lightweight: prints branch + local standards + recent commits. No log rotation, no TLDR warm.
//
// Fail-open: any error in projectAwareness (git read failure, missing files,
// permission issues) must not break the hook.
//
// Delivery: CwdChanged was not part of the 2.1.220 marker probe (only
// PreToolUse/PostToolUse were measured), so there's no direct evidence either
// way for this event. The hookSpecificOutput.additionalContext envelope is
// the only mechanism with ANY observed delivery on tool-adjacent events —
// using it here is strictly no worse than plain stdout, and possibly the
// only path that reaches the model at all.

import { emitAdditionalContext, runHook } from "../lib/hook-runtime.ts";
import { projectAwareness } from "../lib/project-awareness.ts";

async function main(): Promise<void> {
  const lines = await projectAwareness(process.cwd());
  if (lines.length === 0) return;
  emitAdditionalContext("CwdChanged", lines.join("\n"));
}

await runHook(main);
