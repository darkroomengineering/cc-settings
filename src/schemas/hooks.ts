import { z } from "zod";

// --- Hook events ---------------------------------------------------------
// Complete list as of Claude Code 2.1.97 per docs.claude.com/en/docs/claude-code/hooks.
// Kept in sync with upstream/claude-code-manifest.json by the upstream scanner.

export const HookEvent = z.enum([
  // Lifecycle
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "StopFailure",
  "SessionEnd",
  // Subagent + task
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "TeammateIdle",
  // Config + file
  "ConfigChange",
  "CwdChanged",
  "FileChanged",
  "InstructionsLoaded",
  // Worktree
  "WorktreeCreate",
  "WorktreeRemove",
  // Context
  "PreCompact",
  "PostCompact",
  // MCP
  "Elicitation",
  "ElicitationResult",
]);
export type HookEvent = z.infer<typeof HookEvent>;

// --- Hook entry (discriminated union on `type`) --------------------------

const HookCommon = {
  if: z.string().optional(), // permission-rule syntax; PreToolUse/PostToolUse/PermissionRequest
  timeout: z.number().int().positive().optional(),
  async: z.boolean().optional(),
  statusMessage: z.string().optional(),
  once: z.boolean().optional(), // skills/agents only
};

export const CommandHook = z.object({
  type: z.literal("command"),
  command: z.string().min(1),
  ...HookCommon,
});

export const HttpHook = z.object({
  type: z.literal("http"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  allowedEnvVars: z.array(z.string()).optional(),
  ...HookCommon,
});

export const PromptHook = z.object({
  type: z.literal("prompt"),
  prompt: z.string().min(1),
  model: z.string().optional(),
  ...HookCommon,
});

export const AgentHook = z.object({
  type: z.literal("agent"),
  prompt: z.string().min(1),
  model: z.string().optional(),
  ...HookCommon,
});

export const Hook = z.discriminatedUnion("type", [CommandHook, HttpHook, PromptHook, AgentHook]);
export type Hook = z.infer<typeof Hook>;

export const HookGroup = z.object({
  matcher: z.string().optional(),
  if: z.string().optional(), // rule syntax at the group level (current settings.json uses this)
  hooks: z.array(Hook).min(1),
});
export type HookGroup = z.infer<typeof HookGroup>;

// The `hooks` field of settings.json: partial record keyed by event name.
// zod 4's `partialRecord` makes every enum key optional — users only need to
// declare events they actually wire up. The strict enum still catches typos.
export const HooksBlock = z.partialRecord(HookEvent, z.array(HookGroup));
export type HooksBlock = z.infer<typeof HooksBlock>;
