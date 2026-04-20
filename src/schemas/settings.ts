import { z } from "zod";
import { HooksBlock } from "./hooks.ts";
import { McpServers } from "./mcp.ts";
import { Permissions } from "./permissions.ts";

// --- Sub-schemas ----------------------------------------------------------

export const SpinnerVerbs = z.object({
  mode: z.enum(["replace", "append"]),
  verbs: z.array(z.string().min(1)).min(1),
});

export const StatusLine = z.object({
  type: z.literal("command"),
  command: z.string().min(1),
  refreshInterval: z.number().int().positive().optional(), // added 2.1.104
});

export const Attribution = z.object({
  commit: z.string().optional(),
  pr: z.string().optional(),
});

export const TeammateMode = z.enum(["auto", "manual", "disabled"]);

// Sandbox config (introduced 2.1.98–2.1.108). Not yet in any user config in
// this repo; fields verified via docs + changelog. passthrough() on the root
// because the shape is still evolving.
export const Sandbox = z
  .object({
    failIfUnavailable: z.boolean().optional(),
    network: z
      .object({
        deniedDomains: z.array(z.string()).optional(),
      })
      .optional(),
    filesystem: z
      .object({
        allowRead: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .passthrough();

// Model-specific overrides map (2.1.105). Value shape undocumented-but-open;
// keep it permissive until the scanner surfaces its schema.
export const ModelOverrides = z.record(z.string(), z.unknown());

// --- Root -----------------------------------------------------------------

export const Settings = z
  .object({
    $schema: z.string().optional(),

    env: z.record(z.string(), z.string()).optional(),

    model: z.string().optional(),

    // Appearance + UX
    spinnerVerbs: SpinnerVerbs.optional(),
    statusLine: StatusLine.optional(),
    showThinkingSummaries: z.boolean().optional(),

    // Collaboration
    teammateMode: TeammateMode.optional(),
    attribution: Attribution.optional(),

    // Filesystem conventions
    plansDirectory: z.string().optional(),
    includeGitInstructions: z.boolean().optional(),

    // Core
    permissions: Permissions.optional(),
    hooks: HooksBlock.optional(),
    mcpServers: McpServers.optional(),

    // Global toggles / newer knobs (from upstream docs, may not be in user configs yet)
    disableAllHooks: z.boolean().optional(),
    disableAutoMode: z.enum(["disable"]).optional(),
    disableBypassPermissionsMode: z.enum(["disable"]).optional(),
    disableSkillShellExecution: z.boolean().optional(), // 2.1.98
    disableDeepLinkRegistration: z.boolean().optional(), // 2.1.103
    autoScrollEnabled: z.boolean().optional(), // 2.1.102
    autoMemoryDirectory: z.string().optional(), // 2.1.101
    channelsEnabled: z.boolean().optional(),
    allowedChannelPlugins: z.array(z.string()).optional(), // 2.1.107 (team/enterprise)
    allowedMcpServers: z.array(z.string()).optional(), // 2.1.112
    deniedMcpServers: z.array(z.string()).optional(), // 2.1.112
    modelOverrides: ModelOverrides.optional(), // 2.1.105
    feedbackSurveyRate: z.number().optional(), // 2.1.106 (enterprise)
    sandbox: Sandbox.optional(), // 2.1.98–2.1.108 nested
    changelogUrl: z.string().optional(),
  })
  .strict(); // strict: unknown keys fail parse, so drift is caught at install time.

export type Settings = z.infer<typeof Settings>;
