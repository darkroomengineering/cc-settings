#!/usr/bin/env bun
// SessionStart hook: cheap Codex availability detection for the statusline badge.
// Runs `codex login status` (no model call), reconciles with the cached verdict,
// and persists to ~/.claude/tmp/codex-verdict.json. Silent on success and error —
// the badge is the surface. When the bridge is available, also injects the
// default-on routing policy (review + exec by default) as session context.
// Fail-open: never blocks session start.

import { refreshCodexVerdict } from "../lib/codex.ts";
import { emitAdditionalContext, runHook } from "../lib/hook-runtime.ts";

await runHook(async () => {
  const verdict = await refreshCodexVerdict();
  if (verdict.state === "available") {
    emitAdditionalContext(
      "SessionStart",
      "[codex:default-on] Codex bridge is up. Default policy: (1) every diff-producing turn gets a cross-model Codex review before presenting/committing — run the codex-verifier agent (or `bun codex-run.ts review`) in parallel with your own review; (2) route mechanical/bulk implementation to `bun codex-run.ts exec`, batched into few large calls; (3) Claude keeps planning, synthesis, and gate decisions. Fail-open: if Codex is unavailable or hangs (~5 min at 0 CPU — kill it), proceed Claude-only. Skip Codex only for read-only/conversational turns and trivial one-line edits.",
    );
  }
});
