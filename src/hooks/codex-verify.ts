#!/usr/bin/env bun
// SessionStart hook: cheap Codex availability detection for the statusline badge.
// Runs `codex login status` (no model call), reconciles with the cached verdict,
// and persists to ~/.claude/tmp/codex-verdict.json. Silent on success and error —
// the badge is the surface. Fail-open: never blocks session start.

import { refreshCodexVerdict } from "../lib/codex.ts";
import { runHook } from "../lib/hook-runtime.ts";

await runHook(async () => {
  await refreshCodexVerdict();
});
