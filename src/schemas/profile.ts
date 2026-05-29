import { z } from "zod";
import { AgentEffort, AgentModel, AgentPermissionMode } from "./agent.ts";

// Profile frontmatter lives at the top of each profiles/<name>.md file.
//
// ADVISORY ONLY. These fields are validated at install time (by
// src/lib/frontmatter-validate.ts) for *well-formedness*, and they document a
// profile's intended model / skill subset / tool posture so the profile reads as
// a manifest of intent. They are NOT enforced at runtime: cc-settings does not
// switch the active model, gate skills, or restrict tools based on a profile.

export const ProfileFrontmatter = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/, "name must be kebab-case (a-z, 0-9, -)"),
    description: z.string().min(1),
    // Advisory hints — see header note.
    model: AgentModel.optional(),
    skills: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    permissionMode: AgentPermissionMode.optional(),
    effort: AgentEffort.optional(),
  })
  .passthrough();

export type ProfileFrontmatter = z.infer<typeof ProfileFrontmatter>;
