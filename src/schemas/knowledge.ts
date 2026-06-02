import { z } from "zod";

// Knowledge note frontmatter lives at the top of each <name>.md file in the
// team-knowledge repo. The content between the `---` delimiters is YAML,
// parsed separately. This schema validates the parsed object.

// The five knowledge kinds:
//   decision  — an architectural or product decision that was made
//   convention — a team-wide naming/style/process rule
//   gotcha    — a non-obvious trap or foot-gun to watch out for
//   incident  — a post-mortem or incident record
//   pattern   — a reusable solution pattern
export const KnowledgeKind = z.enum(["decision", "convention", "gotcha", "incident", "pattern"]);

export const KnowledgeFrontmatter = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(
        /^[a-z0-9]+(-[a-z0-9]+)*$/,
        "name must be kebab-case (a-z, 0-9, segments joined by single hyphens)",
      ),
    kind: KnowledgeKind,
    tags: z.array(z.string()).optional(),
    "added-by": z.string().min(1),
    supersedes: z.string().optional(),

    // Forward-compat: accept unknown keys rather than rejecting a note that
    // uses a field added in a later schema revision.
  })
  .passthrough();

export type KnowledgeFrontmatter = z.infer<typeof KnowledgeFrontmatter>;
export type KnowledgeKind = z.infer<typeof KnowledgeKind>;
