import { z } from "zod";

// Permission rules are strings in the form `Tool(pattern)` — see
// docs.claude.com/en/docs/claude-code/permissions. We don't parse them here;
// the string shape is validated at rule-enforcement time by Claude Code itself.
// Schema's job is to catch typos in keys, not regex mistakes inside strings.

export const PermissionMode = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
]);

export const AutoModeConfig = z
  .object({
    // Documented shape is loose; keep this permissive until the scanner
    // pins it down. Any unknown keys are flagged by strict parents.
    enabled: z.boolean().optional(),
    allowAll: z.boolean().optional(),
  })
  .passthrough();

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
