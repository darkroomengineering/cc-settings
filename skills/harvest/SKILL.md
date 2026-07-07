---
name: harvest
description: Capture an unusually good workflow into a durable, reviewed artifact — a skill, rule, profile, AGENTS.md diff, or team learning — with measured evidence and an explicit contract. Runs a witnessed-behavior census (multi-witness vs single-witness), fills a harvest contract, validates with blind trap prompts, and emits a PASS / FAIL / INCONCLUSIVE verdict before promotion; seeds /autoresearch when the artifact is a skill. Use when a stronger or temporary model, a one-off session, or a teammate's transcript produced behavior worth preserving before it's lost. Triggers "harvest this workflow", "capture what the model did", "turn this session into a skill", "preserve this behavior", "model handoff", "before we lose access to this model".
context: fork
argument-hint: "[what to harvest]"
---

# harvest

Extract the repeatable procedure behind an unusually good result and land it as a
reviewed cc-settings artifact — with the *evidence measured*, not asserted. The
output is a concrete file (skill, rule, profile section, AGENTS.md diff, or
team-knowledge note) plus a filled [harvest contract](./CONTRACT.md) whose verdict
(PASS / FAIL / INCONCLUSIVE) decides whether it may be promoted, and to what scope.

This is a **ratchet**: it only tightens shared standards on behavior it can show
repeated or survived a trap. Behavior it cannot measure is marked INCONCLUSIVE and
held back, not written up as fact.

## Phase 1 — Witnessed behavior census

Before deciding *what* to harvest, inventory *what was actually seen*. For each
candidate behavior, record — from evidence, not memory:

- **Witness count**: how many independent sessions / transcripts / runs showed it,
  and therefore **multi-witness** (≥2) or **single-witness** (1).
- **What repeated**: the steps that were identical every time — the deterministic core.
- **What varied**: what differed across witnesses. Decide per difference: noise to
  drop, or part of the signal to preserve.
- **Evidence inspected**: the transcripts, PRs, diffs, or outputs you actually read.
- **Not proven**: what you are *inferring* rather than observing. Name the gaps.

Evidence comes two ways — use whichever the user has:

1. **Interview** — 3–5 questions, one at a time: trigger? ordered steps? where the
   default would have gone wrong? how you knew the output was good? what it refused?
2. **Transcript / diff analysis** — the user points at a session, PR, or outputs.
   Read them, reconstruct the same answers yourself, then confirm with the user.

An unknown witness count is `null`, never an optimistic guess. Single-witness is a
valid census result — it just caps how far the artifact can travel (Phase 5).

## Phase 2 — Filter to the harvestable

The bar is **a repeatable procedure, not raw intelligence**. Test each candidate:

- What did the session do *differently* from the default path? ("ran the failing
  test before reading any source", not "it was smarter").
- Would the same steps help a weaker model or a fresh session? If the value was
  depth of reasoning alone, **stop and say so** — that can't be harvested, and prose
  about it is context bloat, not capability.
- Is it already covered? Check the "All Skills" table in `MANUAL.md` and
  `~/.claude/rules/` first. If an existing artifact covers 80% of it, the deliverable
  is a *diff to that artifact*, not a new one.

## Phase 3 — Fill the harvest contract

Distill the census into the [harvest contract](./CONTRACT.md) — copy its template
and fill every field: trigger, observed evidence, procedure, known failure modes,
quality bar, trap prompts, required tools, verification result, promotion decision.

If you can't fill a row with something concrete, it is `null` / INCONCLUSIVE — that
is data, not a blank to paper over. A missing failure mode usually means the
behavior wasn't actually different from the default; go back to Phase 1.

## Phase 4 — Route to the smallest artifact, then write it

| The behavior is… | Artifact | How |
|---|---|---|
| A multi-step workflow a user would invoke | **Skill** | `bun run new-skill` + `docs/skill-authoring.md` |
| An always-on constraint tied to file types | **Rule** | New/edited file in `rules/` with `paths:` frontmatter |
| A workflow bundle for one project type | **Profile** | Section in the matching `profiles/*.md` |
| A universal standard every tool should follow | **AGENTS.md** | Targeted diff to the relevant section |
| A single gotcha, decision, or convention | **Team learning** | Hand off to `/share-learning` |

Bias toward the smallest artifact that carries the procedure — folding into an
existing skill beats adding a new one (see the skill cap in CLAUDE-FULL.md). Author
it in the target's own conventions, carrying the contract's fields into the file:
procedure as steps, failure modes as a DON'T / red-flags section, quality bar as
explicit checks.

For skills, complete registration: `ACTIVE_SKILLS` in `src/lib/managed-skills.ts`,
`MANUAL.md` section + "All Skills" row, then `bun run lint:skills`.

## Phase 5 — Verify: traps, then verdict

Write **2–3 trap prompts** — realistic requests where an agent *without* the
artifact takes the documented bad path. For each:

1. Run it against a fresh subagent **with** the artifact loaded. The subagent must
   not see the trap's expected answer or this checklist (blind-run rule — same as
   `/autoresearch`).
2. Judge the transcript against the contract's quality bar: did it avoid the
   specific failure mode?

Then set the **verification result** per the contract's rubric:

- **PASS** — multi-witness, or single-witness with all traps passing.
- **FAIL** — a trap reproduced the bad path with the artifact loaded. Do not
  promote; revise and re-run, or stop.
- **INCONCLUSIVE** — evidence missing, single-witness with no passing trap, or any
  required field still `null`. Personal draft only; never a shared standard.

The **promotion scope gate** ([CONTRACT.md](./CONTRACT.md)) binds the verdict to how
far the artifact travels: single-witness never reaches `AGENTS.md`, `rules/`,
`profiles/`, or team-knowledge on its own.

## Phase 6 — Seed autoresearch (skills only)

When the routed artifact is a **skill**, hand its evidence forward: write or update
`skills/<name>/RESEARCH.md` so `/autoresearch` can later optimize it.

- `## Test Inputs` ← the trap prompts (one `### Test N:` per trap).
- `## Checklist` ← the quality-bar checks (observable, binary — 3–7 items).
- `## Settings` ← defaults (`samples: 3`, `min_improvement: 0.05`, `max_rounds: 50`).

**Preserve the blind-run rule**: the seed carries only the raw prompt and the binary
criteria — never the expected answer, the scoring rationale, or this conversation's
context. Leaking any of those teaches to the test.

Validate the shape before finishing: `bun run lint:research skills/<name>/RESEARCH.md`
(required sections present, ≥2 test inputs, 3–7 checklist items, numeric settings).

## Deopt / fallback

- **Evidence missing** → mark INCONCLUSIVE. Do not promote; do not invent a PASS.
- **Trap prompts fail** → FAIL. Fix the artifact and re-run, or stop.
- **Unknown numbers** → `null` / INCONCLUSIVE, never aspirational.
- **Unknown territory** — behavior you can't reconstruct, a judgment you can't
  verify from evidence on disk — → fall back to `/verify`, `/oracle`, human
  approval, or normal reasoning rather than forcing a verdict.

## Approval gate

**Stop. Present the artifact and the filled contract (with its verdict). Wait for
approval before:**

- Editing `AGENTS.md`, `rules/`, or `profiles/` (shared standards — every teammate
  inherits these; require multi-witness **and** PASS)
- Posting to the team-knowledge repo via `/share-learning`
- Committing anything

Personal-scope drafts (a new unregistered skill file, a RESEARCH.md seed) may be
written freely; the gate is on anything shared.

## Pairs with

- `/autoresearch` — the optimization loop on a harvested skill; Phase 6 hands it a
  ready RESEARCH.md seeded from the traps and quality bar
- `/share-learning` — the routing target for single-note learnings
- `/verify` or `/oracle` — the fallback when a behavior is real but can't be measured
  into a verdict

## What this skill does NOT do

- **Clone model reasoning.** It captures procedures — steps, checks, gates. If the
  magic was the model itself, the honest output is "not harvestable".
- **Call model APIs** to sample or distill behavior. Evidence comes from the user,
  transcripts, and artifacts already on disk.
- **Assert what it didn't witness.** Unknown counts are `null`; unproven behavior is
  INCONCLUSIVE. Every promotion carries a verdict, or it isn't done.
