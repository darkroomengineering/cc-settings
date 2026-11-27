// What the dispatcher runs for each event, in order, without the handler code.
// src/hooks/dispatch.ts pairs every entry with its loader; src/lib/hooks-doc.ts
// reads it to render the hook tables. Keep this file free of imports: it ships
// to Codex installs, which do not ship dispatch.ts or the handlers.

export type DispatchEvent = "UserPromptSubmit" | "PreToolUse" | "PostToolUse";

export interface HandlerMeta {
  /** Script basename, for error lines. */
  name: string;
  /** Tool-name regex the handler's own config entry used; absent matches every call. */
  matcher?: string;
  /** Seconds the handler's own config entry allowed; absent means none was set. */
  timeoutS?: number;
  /** Label for a block when this handler fails: `[<label>] internal error, failing closed: …`. */
  failClosed?: string;
}

/** Handlers per event in the order the config ran them. */
export const HANDLER_META = {
  UserPromptSubmit: [
    // First: a bounded transcript read, so a slow Jev call in
    // delegation-detector cannot spend the entry budget and skip its warning.
    { name: "cache-cold", timeoutS: 3 },
    { name: "delegation-detector", timeoutS: 3 },
    { name: "quota-steer", timeoutS: 3 },
    { name: "escalate-model", timeoutS: 3 },
  ],
  PreToolUse: [
    { name: "safety-net", matcher: "Bash", timeoutS: 5, failClosed: "Safety Net" },
    // freeze-guard runs before pre-edit-validate so a slow validation cannot
    // spend the shared entry budget and skip the freeze boundary check.
    { name: "freeze-guard", matcher: "Edit|Write", timeoutS: 5 },
    { name: "test-protect", matcher: "Bash|Edit|Write", timeoutS: 5 },
    { name: "spawn-cap", matcher: "Agent|Task", timeoutS: 5 },
    { name: "visual-proof", matcher: "Bash", timeoutS: 5 },
    { name: "config-guard", matcher: "Bash", timeoutS: 5 },
    { name: "linear-gate", matcher: "Bash", timeoutS: 5 },
    { name: "pre-edit-validate", matcher: "Edit", timeoutS: 5 },
    { name: "knowledge-hint", matcher: "Bash|Edit|Write", timeoutS: 5 },
  ],
  PostToolUse: [
    { name: "session-worktrees", matcher: "Agent|Task|EnterWorktree", timeoutS: 5 },
    { name: "post-edit", matcher: "Write|Edit" },
    { name: "tool-cadence", matcher: "Bash|Agent", timeoutS: 3 },
    { name: "promote-memory", matcher: "Write|Edit", timeoutS: 3 },
    { name: "escalate-acted", matcher: "Agent", timeoutS: 3 },
  ],
} as const satisfies Record<DispatchEvent, readonly HandlerMeta[]>;

export type HandlerName = (typeof HANDLER_META)[DispatchEvent][number]["name"];
