---
name: harvest
description: Turn proven session behavior into a skill, rule, profile, AGENTS.md diff, or team learning; artifacts seed /autoresearch evals. Triggers "harvest this workflow", "turn this session into a skill", "preserve this behavior".
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

## Standalone Codex source boundary

Claude frontmatter does not create an isolated fork in standalone Codex. Keep
evidence inspection read-only in the current context or use a fresh native
reader. Audit native rules under `${CODEX_HOME:-$HOME/.codex}/rules`, the
installed `AGENTS.md`, and managed artifacts in the real cc-settings git
checkout named by the Codex sentinel's `repo_path`. Installed plugin/cache files
and `darkroom/source` may be inspected for drift, but never edited as the source
repo.

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

Single-witness is a valid census result; it caps how far the artifact can travel
(the contract's promotion scope gate).

## Phase 2 — Filter to the harvestable

The bar is **a repeatable procedure, not raw intelligence**. Test each candidate:

- What did the session do *differently* from the default path? ("ran the failing
  test before reading any source", not "it was smarter").
- Would the same steps help a weaker model or a fresh session? If the value was
  depth of reasoning alone, **stop and say so** — that can't be harvested, and prose
  about it is context bloat, not capability.
- Is it already covered? In Claude check `docs/skills.md`
  and `~/.claude/rules/`; in standalone Codex use the source boundary above. If
  an existing artifact covers 80% of it, the deliverable
  is a *diff to that artifact*, not a new one.

## Phase 3 — Fill the harvest contract

Distill the census into the [harvest contract](./CONTRACT.md) — copy its template
and fill every field: trigger, observed evidence, procedure, known failure modes,
quality bar, trap prompts, required tools, verification result, promotion decision.

If you can't fill a row with something concrete, it is `null` / INCONCLUSIVE — that
is data, not a blank to paper over; an unknown witness count is `null`, never an
optimistic guess. A missing failure mode usually means the
behavior wasn't actually different from the default; go back to Phase 1.

## Phase 4 — Route to the smallest artifact, then write it

| The behavior is… | Artifact | How |
|---|---|---|
| A multi-step workflow a user would invoke | **Skill** | `bun run new-skill` + `docs/skill-authoring.md` |
| An always-on constraint tied to file types | **Rule** | New/edited file in `rules/` with `paths:` frontmatter |
| A workflow bundle for one project type | **Profile** | Section in the matching `profiles/*.md` |
| A universal standard every tool should follow | **AGENTS.md** | Targeted diff to the relevant section |
| A single gotcha, decision, or convention | **Team learning** | Hand off to `/share-learning` |
| A deterministic operation agents hand-roll and get wrong | **Script** | A `src/scripts/` or skill-local helper the procedure calls |
| A recurring tool-call mistake, or an error signature that keeps returning | **Hook** | `PreToolUse` deny whose reason names the fix, or a `PostToolUse` `additionalContext` hint, wired per `docs/hooks-reference.md` "Adding New Hooks", then `bun run audit:hooks` and `setup.sh` (see `SECURITY.md`) |

Bias toward the smallest artifact that carries the procedure — folding into an
existing skill beats adding a new one (see the skill cap in CLAUDE-FULL.md). Weigh
context cost too: a skill, script, or hook costs nothing until it fires, while an
always-on rule or AGENTS.md line is paid on every turn of every session. Prefer the
on-demand form, and when the artifact must be always-on, cut an equal amount of
existing always-on text in the same diff. Author
it in the target's own conventions, carrying the contract's fields into the file:
procedure as steps, failure modes as a DON'T / red-flags section, quality bar as
explicit checks.

### Repeated corrections

When the harvested behavior is a mistake agents keep making (the user corrected
the same class twice, or reverts and review comments show it), prose is the
weakest artifact: nothing fails when an agent skips it. Assume the next agent
sees only the files it opened and copies the nearest example. Fix the class at
the highest level that works, and say in the contract why each higher level
did not:

1. **Architecture.** One owner per piece of state, one supported way per task,
   one source of truth instead of hand-synced lists. Delete the old way an agent
   would copy.
2. **Types**, so the bad state cannot be written.
3. **A lint or CI check** whose error names the file, type, or function to use
   instead. Read the actual error output: a stock message ("do not use X")
   does not count, so set the rule's custom message or pick a check that has
   one. If the pattern is already common, fail only when a change adds more.
4. **A hook**, when the mistake is an agent action rather than code: a command
   or tool call no type or lint sees. A `PreToolUse` deny whose reason names
   the right command stops it in the loop, where prose can be skipped.
5. **A test** of the behavior (screen it against the
   [test audit checklist](../audit/references/test-audit.md)).
6. **A rule or AGENTS.md line**, only for judgment calls nothing can check.

Prove each new check fails on a real past instance of the mistake, and run the
same command locally and in CI. That proof is this route's trap in Phase 5.
When a correction repeats a rule that already exists but nothing enforces,
treat it as a repeat and move it up the ladder in the same change.

For skills, complete registration: `ACTIVE_SKILLS` in `src/lib/managed-skills.ts`, the human
contract in `docs/skills.md`, then `bun run lint:skills`.

## Phase 5 — Verify: traps, then verdict

Write **2–3 trap prompts** — realistic requests where an agent *without* the
artifact takes the documented bad path. For each:

1. Run it against a fresh subagent **with** the artifact loaded. The subagent must
   not see the trap's expected answer or this checklist (blind-run rule — same as
   `/autoresearch`).
2. Judge the transcript against the contract's quality bar: did it avoid the
   specific failure mode?

Then set the **verification result** (PASS / FAIL / INCONCLUSIVE) per the contract's
verdict rubric, and let its promotion scope gate decide how far the artifact
travels. On FAIL, revise and re-run, or stop.

## Phase 6 — Seed autoresearch (skills only)

When the routed artifact is a **skill**, hand its evidence forward: write or update
`skills/<name>/RESEARCH.md` so `/autoresearch` can later optimize it.

- `## Test Inputs` ← the trap prompts (one `### Test N:` per trap).
- `## Checklist` ← the quality-bar checks (observable, binary — 3–7 items).
- `## Settings` ← defaults (`samples: 3`, `min_improvement: 0.05`, `stall_rounds: 3`).
- No `## Held-out Inputs`: `/autoresearch` writes those itself from the skill's use
  cases, so they stay independent of the traps. The linter's `missing-held-out`
  warning on a fresh seed is expected.

**Preserve the blind-run rule**: the seed carries only the raw prompt and the binary
criteria — never the expected answer, the scoring rationale, or this conversation's
context. Leaking any of those teaches to the test.

Validate the shape before finishing: `bun run lint:research skills/<name>/RESEARCH.md`
(required sections present, ≥2 test inputs, 3–7 checklist items, numeric settings).

## Deopt / fallback

Evidence missing, a trap failing, or an unknown number follows the contract's
Deopt section. For unknown territory (behavior you can't reconstruct, a judgment
you can't verify from evidence on disk), fall back to `/poke-holes`, human
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

## What this skill does NOT do

- **Clone model reasoning.** It captures procedures — steps, checks, gates. If the
  magic was the model itself, the honest output is "not harvestable".
- **Call model APIs** to sample or distill behavior. Evidence comes from the user,
  transcripts, and artifacts already on disk.
- **Assert what it didn't witness.** Every promotion carries a verdict, or it isn't done.
