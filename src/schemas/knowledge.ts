import { z } from "zod";
import { KEBAB_CASE_RE } from "../lib/frontmatter.ts";

// Knowledge note frontmatter lives at the top of each <name>.md file in the
// team-knowledge repo. The content between the `---` delimiters is YAML,
// parsed separately. This schema validates the parsed object.

// The five knowledge kinds:
//   decision  — an architectural or product decision that was made
//   convention — a team-wide naming/style/process rule
//   gotcha    — a non-obvious trap or foot-gun to watch out for
//   incident  — a post-mortem or incident record
//   pattern   — a reusable solution pattern
export const SUMMARY_MAX = 160;

export const KnowledgeKind = z.enum(["decision", "convention", "gotcha", "incident", "pattern"]);

export const KnowledgeFrontmatter = z.looseObject({
  name: z
    .string()
    .min(1)
    .regex(KEBAB_CASE_RE, "name must be kebab-case (a-z, 0-9, segments joined by single hyphens)"),
  kind: KnowledgeKind,
  // The note's line in the corpus INDEX.md: the only text the knowledge-hint
  // hook shows before an agent decides to open the note, so it states the
  // rule. `·` is banned because INDEX.md uses ` · tags:` as its separator.
  summary: z
    .string()
    .min(1)
    .max(SUMMARY_MAX)
    .regex(/^[^·\r\n]*$/, "summary must be one line without '·' (the INDEX.md tag separator)"),
  tags: z.array(z.string()).optional(),
  // Repo names the note applies to. The knowledge-hint hook hides a scoped
  // note in every other repo, so a misspelled name hides it everywhere.
  scope: z
    .array(z.string().regex(KEBAB_CASE_RE, "scope entries must be repo names (kebab-case)"))
    .min(1)
    .optional(),
  // Date the note's version-specific claims were last confirmed. The YAML
  // parser keeps an unquoted date as a string, so one regex covers both forms.
  verified: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "verified must be a YYYY-MM-DD date")
    .optional(),
  "added-by": z.string().min(1),
  supersedes: z.string().optional(),

  // Forward-compat: accept unknown keys rather than rejecting a note that
  // uses a field added in a later schema revision.
});

export type KnowledgeFrontmatter = z.infer<typeof KnowledgeFrontmatter>;
export type KnowledgeKind = z.infer<typeof KnowledgeKind>;
