---
name: harvest
description: Capture an unusually good workflow into a durable, reviewed artifact — a skill, rule, profile, AGENTS.md update, or team learning — validated with trap prompts. Use when a stronger or temporary model, a one-off session, or a teammate's transcript produced behavior worth preserving before it's lost. Triggers "harvest this workflow", "capture what the model did", "turn this session into a skill", "preserve this behavior", "model handoff", "before we lose access to this model".
context: fork
argument-hint: "[what to harvest]"
---

# harvest

Extract the repeatable procedure behind an unusually good result and land it as a
reviewed cc-settings artifact. The output is a concrete file (skill, rule, profile
section, AGENTS.md diff, or team-knowledge note) plus trap-prompt evidence that it
works — never a vague "operating manual".

## Phase 1 — Identify what's actually harvestable

Pin down the specific behavior worth preserving. The bar: **a repeatable procedure**,
not raw intelligence. Ask of the candidate:

- What did the session do *differently* from the default path? (e.g. "it ran the
  failing test before reading any source", not "it was smarter")
- Would the same steps help a weaker model or a fresh session? If the value was
  depth of reasoning alone, **stop and say so** — that can't be harvested, and
  writing prose about it produces context bloat, not capability.
- Is it already covered? Check the "All Skills" table in `MANUAL.md` and
  `~/.claude/rules/` before proceeding. If an existing artifact covers 80% of it,
  the deliverable is a *diff to that artifact*, not a new one.

## Phase 2 — Gather evidence

Two sources, use whichever the user has:

1. **Interview** — 3–5 questions, one at a time: What was the trigger? What steps
   did it take, in order? Where would the default behavior have gone wrong? How did
   you know the output was good? What did it refuse to do?
2. **Transcript / diff analysis** — the user points at a session transcript, a PR,
   or example outputs. Read them and reconstruct the same five answers yourself,
   then confirm the reconstruction with the user before building on it.

## Phase 3 — Extract the four components

Distill the evidence into:

| Component | Question it answers |
|---|---|
| **Procedure** | The ordered steps, with concrete commands where applicable |
| **Failure modes** | What goes wrong without this — the specific bad default path |
| **Quality bar** | How to tell the output is right (observable, not "high quality") |
| **Self-tests** | 2–3 checks the artifact's future user can run to confirm compliance |

If you can't fill a row with something concrete, go back to Phase 2 — a missing
failure mode usually means the behavior wasn't actually different from the default.

## Phase 4 — Route to the right artifact type

| The behavior is… | Artifact | How |
|---|---|---|
| A multi-step workflow a user would invoke | **Skill** | `bun run new-skill` + `docs/skill-authoring.md` |
| An always-on constraint tied to file types | **Rule** | New/edited file in `rules/` with `paths:` frontmatter |
| A workflow bundle for one project type | **Profile** | Section in the matching `profiles/*.md` |
| A universal standard every tool should follow | **AGENTS.md** | Targeted diff to the relevant section |
| A single gotcha, decision, or convention | **Team learning** | Hand off to `/share-learning` |

Bias toward the smallest artifact that carries the procedure. Remember the skill
cap (see CLAUDE-FULL.md "Skill library soft cap") — folding into an existing skill
beats adding a new one.

## Phase 5 — Write it

Author the artifact following the target's own conventions (`docs/skill-authoring.md`
for skills, existing `rules/*.md` structure for rules). Carry all four Phase 3
components into it: procedure as steps, failure modes as a DON'T section or
red-flags list, quality bar as explicit checks, self-tests as a checklist.

For skills, complete the full registration: `ACTIVE_SKILLS` in
`src/lib/managed-skills.ts`, `MANUAL.md` section + "All Skills" row, then
`bun run lint:skills`.

## Phase 6 — Validate with trap prompts

Write **2–3 trap prompts**: realistic requests where an agent *without* the
artifact would take the documented bad path. For each:

1. Run it against a fresh subagent **with** the artifact loaded. The subagent must
   not see the trap's expected answer or this checklist (blind-run rule — same as
   `/autoresearch`).
2. Judge the transcript against the Phase 3 quality bar: did it avoid the specific
   failure mode?

A trap the artifact fails is a revision loop, not a footnote — fix the artifact and
re-run. Record the traps in your report; they become the eval seed if the artifact
later goes through `/autoresearch`.

## Approval gate

**Stop. Present the artifact and trap results. Wait for approval before:**

- Editing `AGENTS.md`, `rules/`, or `profiles/` (shared standards — every teammate
  inherits these)
- Posting to the team-knowledge repo via `/share-learning`
- Committing anything

Personal-scope drafts (a new unregistered skill file) may be written freely; the
gate is on anything shared.

## Pairs with

- `/autoresearch` — later optimization loop on a harvested skill; the Phase 6 traps
  seed its eval set
- `/share-learning` — the routing target for single-note learnings
- `/verify` or `/adversarial-audit` — deeper validation when the harvested behavior
  guards high-stakes work

## What this skill does NOT do

- **Clone model reasoning.** It captures procedures — steps, checks, gates. If the
  magic was the model itself, the honest output is "not harvestable".
- **Call model APIs** to sample or distill behavior. Evidence comes from the user,
  transcripts, and artifacts already on disk.
- **Produce inspirational docs.** Every output is a registered, lintable artifact
  with trap evidence, or it isn't done.
