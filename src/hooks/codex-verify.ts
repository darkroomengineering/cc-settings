#!/usr/bin/env bun
// SessionStart hook: cheap Codex availability detection for the statusline badge.
// Runs `codex login status` (no model call), reconciles with the cached verdict,
// and persists to ~/.claude/tmp/codex-verdict.json. Silent on success and error —
// the badge is the surface. When the bridge is available, also injects the
// batched routing policy (bulk exec by default; one review per PR//ship) as
// session context.
// Fail-open: never blocks session start.

import { refreshCodexVerdict } from "../lib/codex.ts";
import { emitAdditionalContext, runHook } from "../lib/hook-runtime.ts";

await runHook(async () => {
  const verdict = await refreshCodexVerdict();
  if (verdict.state === "available") {
    emitAdditionalContext(
      "SessionStart",
      "[codex:batched] Codex bridge is up. Policy: (1) route mechanical/bulk implementation to `bun codex-run.ts exec`, batched into few large calls; (2) run ONE cross-model Codex review per PR or /ship — the codex-verifier agent or `bun codex-run.ts review` — before the branch is presented for merge, not on every diff-producing turn; also run one when the user asks or before committing a risky change; (3) Claude keeps planning, synthesis, and gate decisions. Fail-open: if Codex is unavailable or hangs (~5 min at 0 CPU — kill it), proceed Claude-only.",
    );
  }
});
