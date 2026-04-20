import { z } from "zod";

// Skill frontmatter lives at the top of each skills/<name>/SKILL.md file.
// The content between the `---` delimiters is YAML, parsed separately (Phase 3
// adds `yaml` runtime dep). This schema validates the parsed object.

// `context` semantics per Darkroom convention:
//   "fork" — skill runs in a forked subagent (independent context)
//   "main" — skill executes inline in the main agent's context
export const SkillContext = z.enum(["fork", "main"]);

// Tools list reuses the same permission-rule strings as settings.json.permissions.
// We keep it as a string array here; the actual allow/deny check happens when
// Claude Code evaluates the skill.
export const SkillFrontmatter = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/, "name must be kebab-case (a-z, 0-9, -)"),
    description: z.string().min(1),
    context: SkillContext.optional(),
    agent: z.string().optional(), // delegates to an agent type by name
    "allowed-tools": z.array(z.string()).optional(),

    // Allow unknown keys — the skills ecosystem is fast-moving and we'd rather
    // accept an unrecognized field than reject a skill that works in newer CC.
    // Contrast with settings.ts which is strict because drift there is the
    // whole reason we have an upstream-sync bot.
  })
  .passthrough();

export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>;
export type SkillContext = z.infer<typeof SkillContext>;
