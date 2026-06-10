import { z } from "zod";

// Skill frontmatter lives at the top of each skills/<name>/SKILL.md file.
// The content between the `---` delimiters is YAML, parsed separately (Phase 3
// adds `yaml` runtime dep). This schema validates the parsed object.

// `context` semantics per Darkroom convention:
//   "fork" — skill runs in a forked subagent (independent context)
//   "main" — skill executes inline in the main agent's context
export const SkillContext = z.enum(["fork", "main"]);

// External prerequisites (CLIs, MCP servers) that a skill needs to function.
// Validated at install: the installer warns the user about missing prereqs
// before they invoke a skill that would runtime-fail. Each entry declares
// exactly one of `command` (CLI on PATH) or `mcp` (MCP server name as
// configured in ~/.claude.json or settings.json `mcpServers`).
export const SkillRequirement = z.union([
  z.object({
    command: z.string().min(1),
    install: z.string().optional(),
  }),
  z.object({
    mcp: z.string().min(1),
    install: z.string().optional(),
  }),
]);

// Tools list reuses the same permission-rule strings as settings.json.permissions.
// We keep it as a string array here; the actual allow/deny check happens when
// Claude Code evaluates the skill.
export const SkillFrontmatter = z.looseObject({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "name must be kebab-case (a-z, 0-9, -)"),
  description: z.string().min(1),
  context: SkillContext.optional(),
  agent: z.string().optional(), // delegates to an agent type by name
  "allowed-tools": z.array(z.string()).optional(),
  requires: z.array(SkillRequirement).optional(),

  // Allow unknown keys — the skills ecosystem is fast-moving and we'd rather
  // accept an unrecognized field than reject a skill that works in newer CC.
  // Same loose-by-design policy as settings.ts: unknown keys from newer
  // Claude Code versions must parse; typo protection comes from the key-name
  // guard test in tests/schemas.test.ts, not from schema strictness.
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>;
export type SkillContext = z.infer<typeof SkillContext>;
export type SkillRequirement = z.infer<typeof SkillRequirement>;
