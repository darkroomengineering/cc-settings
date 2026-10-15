# Skill Authoring Guide

How to create, structure, and register a new cc-settings skill.

---

## Quickstart

```bash
bun run new-skill <name>
```

This scaffolds `skills/<name>/SKILL.md` with starter frontmatter. Then fill in the description and body per the rules below.

---

## Frontmatter Rules

```yaml
---
name: skill-name
description: "Concise trigger phrases and a one-sentence summary."
context: fork
---
```

### `name`

- Kebab-case. Must match the directory name exactly.
- No uppercase, no spaces.

### `description`

- Minimum ~50 characters. The Skill tool reads this to decide whether to load your skill for the current conversation — it is the only signal the selector sees.
- Write in the user's voice: "Triggers when user says X", not "Does Y".
- Be specific. "Helps with code" is too broad. "Triages GitHub issues through a label-based state machine" is not.
- Include concrete trigger phrases — the words a user would actually type. Name the situation the skill handles, never the topic it touches: `fix` triggers on "broken" and "fix CI", not on "bug" or "error", because a topic word fires the skill on every conversation that mentions it. Current models (Claude 5, GPT-6 Astra) pick skills well from short precise descriptions and over-load from broad ones; see OpenAI's "Rethinking skills and prompts for GPT-6 Astra".
- Name a neighbor only when the two collide on the same phrase ("Hook-level checks go to /review"). A skip clause for every adjacent skill is noise.
- Max ~1024 chars total. The description appears in every agent's system prompt; verbose descriptions burn context across the fleet.
- No `<` or `>` characters (YAML angle-bracket issue).

### `context`

- `fork` — skill runs in a forked context (doesn't bloat main session). Use this for most skills. As of v2.1.218 it also runs in the background by default: the result comes back as a task notification, not inline output, so don't write a fork skill's body assuming the user is watching it stream.
- `main` — skill body is injected into main context (`src/schemas/skill.ts` defines `SkillContext = z.enum(["fork", "main"])`). Use for lightweight, single-turn instructions, or when the skill needs to see or shape the rest of the conversation directly. Shipped skills declaring it explicitly: `audit`, `codex`, `freeze`, `zero-tech-debt`.
- Omitting the field also resolves to inline, same as `main` — but the shipped convention is to declare `context: main` explicitly rather than rely on the omission.

### Optional frontmatter fields

- `agent: <name>` — delegate to a specific named agent (e.g. `agent: explore`, `agent: tester`).
- `argument-hint: "[arg]"` — displayed in the slash command picker.
- `requires:` — a list of external prerequisites (CLIs or MCP servers) the skill needs at runtime. The installer warns about missing ones before a skill that would runtime-fail gets invoked. Each entry declares **exactly one** of `command` or `mcp` (never both — `SkillRequirementShapeGuard` in `src/schemas/skill.ts` rejects entries that declare both), plus an optional `install` hint string:

  ```yaml
  requires:
    - command: gh
      install: "Install GitHub CLI and run `gh auth login`."
    - mcp: [chrome-devtools, aside-devtools]
      optional: true
      install: "Either DevTools MCP adds on-demand audits and screenshots; the skill runs without one."
  ```

  `mcp` takes one name or a list; a list is satisfied by any one registered server. `optional: true` marks a prerequisite the skill degrades without: the installer never warns about it, and the skill body must say what happens when it is absent (since 15.22.2).

  See `skills/share-learning/SKILL.md` (command) and `skills/audit/SKILL.md` (mcp-only) for the 2 shipped examples.

---

## Body Structure

Match the existing skills (`skills/fix/SKILL.md`, `skills/cc/SKILL.md`, `skills/handoff/SKILL.md` are good models):

1. **Open with a one-sentence statement** of what the skill produces or enforces.
2. **Phase headings** (`## Phase 1 — …`) for multi-step workflows.
3. **Concrete commands and bash snippets** where applicable.
4. **Approval gates** for destructive or judgment-call work — mark them clearly: **Stop. Present the plan.**
5. **"What this skill does NOT do"** section if there's a real boundary worth flagging.

### Body order and length

After compaction, Claude Code re-attaches only the first 5,000 tokens of each invoked skill, within a shared 25,000-token budget across all invoked skills ([Skill content lifecycle](https://code.claude.com/docs/en/skills)). Whatever sits past that point is gone from a long session. Put the steps and gates that must survive first, and put reference detail (formats, examples, long tables) last or in separate files.

Keep `SKILL.md` under 500 lines, the limit the same page gives under "Add supporting files". `bun run lint:skills` fails a longer body (`body-too-long`). `audit`, `cc`, and `autoresearch` exceed it and are held to their recorded line counts in `SKILL_BODY_LINE_EXEMPTIONS` (`src/lib/lint-skills.ts`): they may shrink but not grow, and the linter tells you to lower the number when one shrinks.

---

## When to Add Reference Files

Split content across additional files in the skill's directory only when:

- `SKILL.md` exceeds ~150 lines and has distinct sub-domains
- A format spec or template is reused (e.g., `CONTEXT-FORMAT.md`, `ADR-FORMAT.md`)
- A consumer-rules doc is shared with sibling skills (e.g., `DOMAIN-AWARENESS.md`)

Reference from `SKILL.md` with a relative link: `[CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md)`.

---

## When to Add Scripts

Add a TypeScript helper in `src/scripts/` when:

- The operation is deterministic (parse a file, format output, validate input)
- The same logic would otherwise be regenerated by the agent every time
- Errors need explicit handling that the prose can't enforce

Reference from the skill: `bun "$HOME/.claude/src/scripts/<name>.ts"`.

---

## Registration

1. Add `"<name>"` to `ACTIVE_SKILLS` in `src/lib/managed-skills.ts` (alphabetical order). `MANAGED_SKILLS` in `src/setup.ts` is just `[...ACTIVE_SKILLS, ...TOMBSTONE_SKILLS]` imported from that module — it isn't a list you edit directly, and `bun run lint:skills`'s `checkManaged` rule enforces `ACTIVE_SKILLS` specifically (a skill added to `TOMBSTONE_SKILLS` instead still fails as `managed-skills-missing`).
2. Add or update the human-facing value, effects, output, and host contract in `docs/skills.md`.

---

## Skills born from `/harvest`

When a skill is captured by `/harvest` rather than authored from scratch, it arrives
with two extra assets, and the same standards apply to both:

- A **filled harvest contract** (`skills/harvest/CONTRACT.md` template) recording the
  witnessed evidence and a PASS / FAIL / INCONCLUSIVE verdict. Only a PASS (or a
  multi-witness PASS, for shared standards) justifies registering the skill here —
  an INCONCLUSIVE harvest stays a personal draft, unregistered.
- A **RESEARCH.md seed** at `skills/<name>/RESEARCH.md`, so `/autoresearch` can tune
  the prompt later. Its `## Test Inputs` are the harvest trap prompts and its
  `## Checklist` is the quality bar — kept blind (no expected answers, no scoring
  rationale). Validate its shape with `bun run lint:research skills/<name>/RESEARCH.md`
  before committing.

RESEARCH.md is a sibling file, not a second skill — the skills linter ignores it, so
it never trips the folder conventions above.

---

## Evaluating a skill change

Every skill has cases in `evals/<skill>-<slug>/`, and the pre-push hook runs the cases for skills changed since upstream (`bun src/scripts/eval-changed.ts`). A change to routing, questions, stopping points, or side effects needs a case that can fail. Build the cases by these rules:

- **Build cases from caller-shaped tasks.** Write the prompt the way a user, or a calling skill, reaches this skill, with the same one-line context and none of the skill's own wording. A task that tells the agent what the skill is about measures the task text, and an agent given loose text does extra work on its own.
- **Grade overreach, not only the intended edit.** Assert the skill left alone what it should leave alone: unrelated files, commits, new files, tests nobody asked for. A grader that checks only the intended outcome passes a run that did the job and then some.
- **Add one restraint case per rule the skill adds.** A plain input with no triggering condition must not trigger the new behavior. A rule that fires on everything is as broken as one that never fires.
- **Reproduce at least one case from a real failure.** A session that went wrong or a review finding. Cases invented to fit the mechanism contain its happy path: one matcher scored 100% recall on its authored corpus and 20-36% on a pair captured from a real run.
- **Treat 100% on every arm as a corpus smell.** When old and new, or skill and vanilla, all pass, the cases do not discriminate, and the result says nothing about the change.
- **Show improvement with a base arm.** A change that passes both before and after proves only that nothing regressed, and a strong model often masks a defensive fix. Run `bun src/scripts/eval-changed.ts --base-arm`: it also runs each changed skill's cases against the merge-base version and labels every case `improvement` (old fails, new passes), `regression`, `no-regression-only` (both pass), or `still-failing`. The cost ceiling covers both arms.

A score difference smaller than run-to-run variance is not a result. `bun src/scripts/eval-ablate.ts --aa` runs the same plugin twice per pair, alternating run order, and prints the spread; pass it as `--noise <n>` to a normal comparison and deltas below it print as "within noise".

---

## Common Pitfalls

### Over-broad description
"Helps with testing" matches every test-related question — including those already covered by `/review`, `/poke-holes`, `/build`. Be narrower: "Triages GitHub issues through a label-based state machine."

### Trigger overlap with existing skills
Check the "All Skills" table in `MANUAL.md` before writing triggers. If your skill's triggers overlap significantly with an existing one, either narrow your triggers or propose merging.

### Implementation detail in description
The description is read by the Skill selector, not by the agent executing the skill. It should say *when to use* the skill, not *how it works internally*.

### No approval gate on destructive ops
Any skill that deletes files, commits, pushes, or calls external APIs must have a visible **Stop. Present the plan. Wait for approval.** gate before executing. Model this on `skills/cc/SKILL.md` Phase 4.

### Time-sensitive content in body
Don't hardcode version numbers or dates in skill bodies. They go stale silently. Reference `bun info <pkg>` patterns or external docs instead.

### Mirroring the code instead of stating principles
A skill (or doc) that enumerates exact file lists, helper names, command matrices, or scenario inventories the code already holds will drift the moment the code moves. Write the **glossary of principles** — what the skill decides and why — and point at the code or a generated table for the inventory. (This is the same lesson as the July 2026 doc-drift audit finding: docs are an unguarded fourth source of truth unless they defer detail to the artifact that owns it.)

### Orphan siblings
When two skills are designed to hand off to each other (plan → implement, audit → fix, save → resume), say so in both bodies — a short "Pairs with `/other-skill` (what it contributes)" line. The selector reads descriptions in isolation; the pairing context otherwise lives only in the author's head.

---

## Review Checklist

Before committing a new skill:

- [ ] `description` includes specific trigger phrases in the user's voice, naming situations rather than topics
- [ ] `description` is at least 50 chars, under 1024 chars
- [ ] No `<` or `>` characters in frontmatter
- [ ] `name` matches the directory name (kebab-case)
- [ ] No overlap with existing skills (or overlap is intentional and noted)
- [ ] Frontmatter passes `bun run lint:skills` (0 errors)
- [ ] Skill registered in `ACTIVE_SKILLS` (`src/lib/managed-skills.ts`, alphabetical)
- [ ] Row added to `MANUAL.md`
- [ ] Concrete examples or commands in the body
- [ ] Approval gates marked for destructive operations
- [ ] Steps and gates that must survive compaction come first; `SKILL.md` is under 500 lines
- [ ] Eval cases follow "Evaluating a skill change" (caller-shaped, overreach graded, one restraint case)
- [ ] No hardcoded versions or dates in the body
- [ ] `bun test && bun run typecheck` pass

---

## Examples

### Minimal skill (advice wrapper)

```yaml
---
name: ask-auth
description: Expert advice on authentication patterns — JWT vs sessions, OAuth providers, token refresh. Triggers "auth question", "authentication advice", "which auth approach".
context: fork
agent: planner
---

# ask-auth

Delegate to the planner agent for authentication architecture guidance.
```

### Multi-phase skill with approval gate

See `skills/cc/SKILL.md` (sync mode) as a canonical example of: phase headings, bash snippets, a hard approval gate before edits, and a "What this skill does NOT do" boundary section.

### Skill with supporting reference file

See `skills/context-doc/` — `SKILL.md` is the entry point; `DOMAIN-AWARENESS.md` is a shared consumer doc that sibling skills (`/explore`) reference.
