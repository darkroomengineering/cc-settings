import { z } from "zod";

// Permission rules are strings in the form `Tool(pattern)` — see
// docs.claude.com/en/docs/claude-code/permissions. We don't parse them here;
// the string shape is validated at rule-enforcement time by Claude Code itself.
// Schema's job is to catch typos in keys, not regex mistakes inside strings.

// Mirrors the knownPermissionModes list in upstream/claude-code-manifest.json.
// Drift here breaks agent loading silently — keep it strict so the upstream
// scanner catches new values when Anthropic ships them. This is the single
// source of truth; agent.ts re-exports it as AgentPermissionMode.
export const PermissionMode = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
]);

export const AutoModeConfig = z.looseObject({
  // Documented shape is loose; keep this permissive until the scanner
  // pins it down. Any unknown keys are flagged by strict parents.
  enabled: z.boolean().optional(),
  allowAll: z.boolean().optional(),
  // v2.1.136 — classifier rules that block unconditionally regardless of
  // user intent or allow exceptions. Same rule-string syntax as
  // `permissions.deny`.
  hard_deny: z.array(z.string()).optional(),
});

export const Permissions = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  ask: z.array(z.string()).optional(),
  additionalDirectories: z.array(z.string()).optional(),
  defaultMode: PermissionMode.optional(),
  autoMode: AutoModeConfig.optional(),
});
export type Permissions = z.infer<typeof Permissions>;
export type PermissionMode = z.infer<typeof PermissionMode>;
