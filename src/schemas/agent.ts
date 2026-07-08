import { z } from "zod";
import { KEBAB_CASE_RE } from "../lib/frontmatter.ts";
import { PermissionMode } from "./permissions.ts";

// Agent frontmatter lives at the top of each agents/<name>.md file.
// Validated at install time by src/lib/frontmatter-validate.ts so typos
// (effort: xtreme, permissionMode: planning) are caught before they
// silently degrade the agent.

export const AgentEffort = z.enum(["low", "medium", "high", "xhigh", "max"]);

// Model aliases match Claude Code conventions. The list is intentionally
// loose (string fallback) — Anthropic ships new aliases between cc-settings
// releases and we'd rather accept than reject.
export const AgentModel = z.union([
  z.enum(["opus", "sonnet", "haiku", "fable"]),
  z.string().min(1), // pinned variants like "opus[1m]" or full IDs
]);

// Single source of truth for permission modes is PermissionMode in
// permissions.ts (which mirrors the upstream manifest list). Re-exported
// under the agent-flavored name so existing importers keep working.
export const AgentPermissionMode = PermissionMode;

// Mirrors knownAgentIsolation / knownAgentMemory in
// upstream/claude-code-manifest.json — keep in sync so the upstream scanner
// catches drift (see src/upstream/scan.ts). Widened 2026-07-06 (issue
// #82/#104): "remote" isolation and "user"/"local" memory scopes are real,
// documented values (see docs/frontmatter-reference.md) that were previously
// rejected by these enums.
export const AgentIsolation = z.enum(["worktree", "remote"]);
export const AgentMemory = z.enum(["user", "project", "local"]);

export const AgentFrontmatter = z.looseObject({
  name: z
    .string()
    .min(1)
    .regex(KEBAB_CASE_RE, "name must be kebab-case (a-z, 0-9, single hyphens)"),
  description: z.string().min(1),
  model: AgentModel.optional(),
  tools: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(), // alias for `tools` (docs/frontmatter-reference.md)
  disallowedTools: z.array(z.string()).optional(),
  maxTurns: z.number().int().positive().optional(),
  permissionMode: AgentPermissionMode.optional(),
  effort: AgentEffort.optional(),
  isolation: AgentIsolation.optional(),
  memory: AgentMemory.optional(),
  color: z.string().optional(),
  initialPrompt: z.string().optional(),
  skills: z.array(z.string()).optional(), // skills to preload into the subagent context
  background: z.boolean().optional(), // always run this subagent as a background task
  // Future-leaning — accepted but not validated deeply.
  hooks: z.unknown().optional(),
  mcpServers: z.record(z.string(), z.unknown()).optional(),

  // Loose on unknown keys — agent ecosystem is fast-moving and we'd
  // rather accept an unrecognized field than block install for a new agent
  // shipped by a future Claude Code version.
});

export type AgentFrontmatter = z.infer<typeof AgentFrontmatter>;
export type AgentEffort = z.infer<typeof AgentEffort>;
export type AgentPermissionMode = z.infer<typeof AgentPermissionMode>;
export type AgentIsolation = z.infer<typeof AgentIsolation>;
export type AgentMemory = z.infer<typeof AgentMemory>;
