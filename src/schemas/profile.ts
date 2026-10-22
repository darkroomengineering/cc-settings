import { z } from "zod";
import { KEBAB_CASE_RE } from "../lib/frontmatter.ts";
import { AgentEffort, AgentModel, AgentPermissionMode } from "./agent.ts";

// Profile frontmatter lives at the top of each profiles/<name>.md file.
//
// ADVISORY ONLY. These fields are validated at install time (by
// src/lib/frontmatter-validate.ts) for *well-formedness*, and they document a
// profile's intended model / skill subset / tool posture so the profile reads as
// a manifest of intent. They are NOT enforced at runtime: cc-settings does not
// switch the active model, gate skills, or restrict tools based on a profile.

export const ProfileFrontmatter = z.looseObject({
  name: z
    .string()
    .min(1)
    .regex(KEBAB_CASE_RE, "name must be kebab-case (a-z, 0-9, single hyphens)"),
  description: z.string().min(1),
  // Advisory hints — see header note.
  model: AgentModel.optional(),
  skills: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  permissionMode: AgentPermissionMode.optional(),
  effort: AgentEffort.optional(),
});

export type ProfileFrontmatter = z.infer<typeof ProfileFrontmatter>;
