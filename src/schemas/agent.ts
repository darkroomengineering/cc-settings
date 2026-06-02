import { z } from "zod";

// Agent frontmatter lives at the top of each agents/<name>.md file.
// Validated at install time by src/lib/frontmatter-validate.ts so typos
// (effort: xtreme, permissionMode: planning) are caught before they
// silently degrade the agent.

export const AgentEffort = z.enum(["low", "medium", "high", "xhigh", "max"]);

// Model aliases match Claude Code conventions. The list is intentionally
// loose (string fallback) — Anthropic ships new aliases between cc-settings
// releases and we'd rather accept than reject.
export const AgentModel = z.union([
  z.enum(["opus", "sonnet", "haiku"]),
  z.string().min(1), // pinned variants like "opus[1m]" or full IDs
]);

// Mirrors the knownPermissionModes list in upstream/claude-code-manifest.json.
// Drift here breaks agent loading silently — keep it strict so the upstream
// scanner catches new values when Anthropic ships them.
export const AgentPermissionMode = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
]);

export const AgentIsolation = z.enum(["worktree"]);
export const AgentMemory = z.enum(["project"]);

export const AgentFrontmatter = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/, "name must be kebab-case (a-z, 0-9, -)"),
    description: z.string().min(1),
    model: AgentModel.optional(),
    tools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).optional(),
    maxTurns: z.number().int().positive().optional(),
    permissionMode: AgentPermissionMode.optional(),
    effort: AgentEffort.optional(),
    isolation: AgentIsolation.optional(),
    memory: AgentMemory.optional(),
    color: z.string().optional(),
    initialPrompt: z.string().optional(),
    // Future-leaning — accepted but not validated deeply.
    hooks: z.unknown().optional(),
    mcpServers: z.record(z.string(), z.unknown()).optional(),

    // Permissive on unknown keys — agent ecosystem is fast-moving and we'd
    // rather accept an unrecognized field than block install for a new agent
    // shipped by a future Claude Code version.
  })
  .passthrough();

export type AgentFrontmatter = z.infer<typeof AgentFrontmatter>;
export type AgentEffort = z.infer<typeof AgentEffort>;
export type AgentPermissionMode = z.infer<typeof AgentPermissionMode>;
