---
name: nuclear-review
description: Extremely strict whole-codebase maintainability audit — checks structural quality, 1k-line file sprawl, thin wrappers, leaked logic, spaghetti growth, and dependency freshness + usage quality via context7. Pushes "code-judo" moves that delete whole branches instead of rearranging them. When fixes land, the same pass updates CHANGELOG, MANUAL, and derived schemas so the docs don't drift. Triggers "nuclear review", "thermonuclear review", "thermo-nuclear code quality review", "code judo", "deep code quality audit", "harsh maintainability review", "whole codebase review". Sibling to `/review` (per-diff Darkroom checklist) and `/zero-tech-debt` (rework patch to end-state).
context: main
requires:
  - mcp: context7
---

# Nuclear Review

An unusually strict **whole-codebase** maintainability audit. Reviews implementation quality, abstraction quality, structural simplification opportunities, **and** dependency freshness + usage quality.

Adapted from Cursor's internal `thermo-nuclear-code-quality-review` skill. Cursor's version targets a single PR diff; this version targets the entire repository and adds a context7-driven dependency audit on top, because the same questions ("is this the right abstraction?", "is this thin wrapper earning its keep?") apply equally to library choices.

Above all, this skill should push the reviewer to be **ambitious** about code structure. Do not merely identify local cleanup opportunities. Actively search for "code judo" moves: restructurings that preserve behavior while making the implementation dramatically simpler, smaller, more direct, and more elegant.

## When to use vs other review skills

- `/review` — per-PR Darkroom checklist (TypeScript / React / a11y / perf / security). Run on every change.
- `/nuclear-review` — periodic whole-codebase audit. Run on major version cuts, after extended velocity sprints, before a load-bearing migration, or whenever the codebase feels heavier than its features warrant.
- `/zero-tech-debt` — rework a specific patch to its intended end-state. Not a review — it edits.

A typical sequence: `/nuclear-review` produces findings → engineers cherry-pick the highest-leverage ones → `/zero-tech-debt` or `/refactor` to execute.

> **Tip (Claude Code v2.1.154+)**: run `/effort ultracode` before invoking this skill. The whole-codebase audit is the canonical shape that benefits from dynamic workflows — phase state lives in the workflow script rather than Claude's context window, individual modules can be reviewed in parallel (up to 16 concurrent), and the run can resume from cached agent results within the session.
>
> A ready-made example ships at `references/nuclear-review.workflow.js` (installed to `~/.claude/skills/nuclear-review/references/`). It is **opt-in, not a dependency** — the skill above works with no Workflow tool. Run it with `Workflow({ scriptPath: "~/.claude/skills/nuclear-review/references/nuclear-review.workflow.js" })`, or copy it into `.claude/workflows/`. It maps the repo, fans out one structural reviewer per module, audits dependencies, and synthesizes one report. Treat it as a **template** — adapt its module list, schemas, and phases to the repo at hand rather than running it verbatim.

## Scope

The audit covers the **entire codebase**, not the current diff. That includes:

- All source modules — application code, libraries, scripts, hooks, configs
- The dependency manifest (`package.json` + lockfile) — every direct dependency
- Folder structure and module boundaries
- Top-level architectural surfaces (routes, providers, exported APIs)

Skip vendored code, generated files, and `node_modules`.

## Workflow

### Phase 0 — Map the codebase

Establish ground truth before judging anything.

```bash
# Top-level structure
fd -t d -d 2 --hidden -E node_modules -E .git -E dist -E build

# File-size distribution (largest first) — find the 1k-line crossings
fd -t f -E node_modules -E .git -E dist -E build \
  -e ts -e tsx -e js -e jsx -e py -e go -e rs \
  -x wc -l {} \; | sort -rn | head -50

# Direct dependency count
jq '.dependencies + .devDependencies | length' package.json

# Direct deps with versions
jq '.dependencies + .devDependencies' package.json
```

If the project uses `tldr`, prefer it for the call graph + dead-code pass:

```bash
tldr arch .
tldr dead . --entry-points "main,test_"
```

### Phase 1 — Dependency audit (context7)

For each direct dependency in `package.json`, use the `context7` MCP server to verify:

1. **Currency** — is the installed version current, or stale? Note major-version gaps.
2. **Usage quality** — is the codebase using the dependency in the way the maintainers currently recommend? Old APIs, deprecated patterns, missing newer affordances?
3. **Necessity** — could it be replaced by a platform built-in, an existing canonical helper, or a smaller dependency?
4. **Overlap** — does it duplicate the role of another dependency? (Two date libraries, two state managers, two HTTP clients.)
5. **Footprint cost** — for any dependency contributing >50KB to the client bundle, is the usage scope worth the cost? Could it be code-split, lazy-loaded, or replaced?

Use context7 in two steps per dependency:

```
mcp__context7__resolve-library-id { libraryName: "<package>", query: "<what we use it for>" }
mcp__context7__query-docs { libraryId: "<resolved id>", query: "current recommended usage vs <pattern we use>" }
```

Cap context7 calls at 3 per dependency (per the server's own guidance). Batch the audit: pick the top 10–20 by either bundle weight or surface-area coverage rather than auditing every transitive dep.

Output for each flagged dep: current version → recommended version, deprecated APIs in use, suggested fix.

### Phase 2 — Structural audit

Apply the non-negotiable standards below to the codebase as a whole. Walk the largest files first, then the modules with the most outbound dependencies, then the entry points.

### Phase 3 — Synthesis

Produce the output in the format below. Prioritize ruthlessly — a smaller number of high-conviction findings beats a long list.

### Phase 4 — Documentation updates (after fixes land)

A nuclear-review that produces fixes but leaves the docs stale is half-done. Whenever findings from this skill turn into code changes, the same pass must touch the docs that describe them. If you only produce the report (no fixes in this session), skip this phase — but flag it for whoever applies the fixes.

For each commit that lands from the audit, update the docs in scope for the change:

| Type of change | What to update |
|---|---|
| New skill / agent / hook / profile | `MANUAL.md` (the "All Skills" / "All Agents" table + the appropriate prose section), `CHANGELOG.md`, skill-count references in `CLAUDE.md` / `CLAUDE-FULL.md` if the count moves |
| Structural refactor (dedup, extract module, rename across files) | `CHANGELOG.md` — a one-paragraph entry under `[Unreleased]` explaining what moved and why |
| Dependency upgrade or deprecated-API swap | `CHANGELOG.md` — note the package, the old vs new pattern, and any caller-visible behavior |
| New canonical helper that supersedes inline duplicates | `CHANGELOG.md`, and `rules/*.md` if the helper is now the project-wide recommended pattern |
| Type/boundary cleanup at a JSON or external-input boundary | `CHANGELOG.md`, and `docs/security-reference.md` if the change affects validation |
| API surface change (exported function signature, public schema) | `CHANGELOG.md`, `docs/*-reference.md` for any reference docs that mention the symbol, schemas via `bun run schemas:emit` if the zod surface moved |

Rules for the doc pass:

- **One `[Unreleased]` entry per landed commit, or one consolidated entry if multiple commits ship together.** Don't leave audit-driven refactors anonymous in git history.
- **Skill / agent / rule counts must match reality.** If you added or removed one, update every reference (`MANUAL.md` intro, `CLAUDE.md`, `CLAUDE-FULL.md`).
- **Don't pad.** Each entry is one short paragraph naming the file(s) changed and the why. Skip prose victory laps.
- **Regenerate derived docs.** If you changed a zod schema in `src/schemas/`, run `bun run schemas:emit` and commit the resulting `schemas/*.schema.json` diff alongside the source change.
- **Update `MANUAL.md` triggers tables** when a skill's invocation phrasing changes or when a new skill goes in.

Verify the doc pass landed correctly before finishing:

```bash
bun run lint:skills            # frontmatter sanity
bun run schemas:check          # derived schemas in sync with sources
git diff --stat HEAD~N HEAD    # confirm doc files are in the diff
```

## Non-Negotiable Standards

0. **Be ambitious about structural simplification.**
   - Do not stop at "this could be a bit cleaner."
   - Look for opportunities to reframe code so whole branches, helpers, modes, conditionals, or layers disappear entirely.
   - Prefer the solution that makes the code feel inevitable in hindsight.
   - Assume there is often a "code judo" move available: a re-organization that uses the existing architecture more effectively and makes the surface dramatically simpler and more elegant.
   - If you see a path to delete complexity rather than rearrange it, push hard for that path.

1. **Flag every file over 1k lines.**
   - Treat it as a strong code-quality smell by default.
   - Prefer extracting helpers, subcomponents, modules, or local abstractions instead of letting files sprawl past 1000 lines.
   - Only waive if there is a compelling structural reason and the resulting file is still clearly organized.

2. **Do not tolerate spaghetti.**
   - Be highly suspicious of ad-hoc conditionals, scattered special cases, or one-off branches inserted into otherwise cohesive flows.
   - "Weird if statements in random places" is a design problem, not a stylistic nit.
   - Prefer pushing logic into a dedicated abstraction, helper, state machine, policy object, or separate module instead of tangling existing paths.
   - Call out code that makes the surrounding area harder to reason about, even if it technically works.

3. **Bias toward cleaning the design, not preserving working code.**
   - If behavior can stay the same while structure becomes meaningfully cleaner, push for the cleaner version.
   - Do not rubber-stamp "it works" implementations that leave the codebase messier.
   - Prefer simplifications that remove moving pieces altogether over refactors that merely spread the same complexity around.

4. **Prefer direct, boring, maintainable code over hacky or magical code.**
   - Treat brittle, ad-hoc, or "magic" behavior as a code-quality problem.
   - Be skeptical of generic mechanisms that hide simple data-shape assumptions.
   - Flag thin abstractions, identity wrappers, or pass-through helpers that add indirection without buying clarity.

5. **Push hard on type and boundary cleanliness.**
   - Question unnecessary optionality, `unknown`, `any`, or cast-heavy code when a clearer type boundary could exist.
   - Prefer explicit typed models or shared contracts over loosely-shaped ad-hoc objects.
   - If a branch relies on silent fallback to paper over an unclear invariant, ask whether the boundary should be made explicit instead.

6. **Keep logic in the canonical layer and reuse existing helpers.**
   - Call out feature logic leaking into shared paths or implementation details leaking through APIs.
   - Prefer existing canonical utilities/helpers over bespoke one-offs.
   - Push code toward the right package, service, or module instead of normalizing architectural drift.

7. **Treat unnecessary sequential orchestration and non-atomic updates as design smells.**
   - If independent work is serialized for no good reason, ask whether the flow should run in parallel instead.
   - If related updates can leave state half-applied, push for a more atomic structure.
   - Do not over-index on micro-optimizations, but do flag avoidable orchestration complexity.

8. **Dependencies must be current and well-used.**
   - Flag any direct dependency on a deprecated major version.
   - Flag usage patterns the maintainers have superseded (e.g., legacy hooks, deprecated config shapes, pre-codemod call sites).
   - Flag direct dependencies that duplicate another dependency's role.
   - Flag dependencies whose footprint is disproportionate to their use.
   - Flag dependencies that could be removed entirely in favor of a platform primitive or existing canonical helper.

## Primary Review Questions

For every meaningful surface, ask:

- Is there a "code judo" move that would make this dramatically simpler?
- Can this be reframed so fewer concepts, branches, or helper layers are needed?
- Does this improve or worsen the local architecture?
- Did the codebase grow branching complexity where a better abstraction should exist?
- Did a previously cohesive module become more coupled, more stateful, or harder to scan?
- Is this logic living in the right file and layer?
- Is the implementation direct and legible, or does it rely on special cases and incidental control flow?
- Is this abstraction actually earning its keep, or is it just a wrapper?
- Did anyone introduce casts, optionality, or ad-hoc object shapes that obscure the real invariant?
- Is this logic living in the canonical layer, or did detail leak across a boundary?
- Is this orchestration more sequential or less atomic than it needs to be?
- **Is every direct dependency current and idiomatic for its installed major?**
- **Does any dependency duplicate the role of another, or one that the platform already offers?**

## What to Flag Aggressively

- Complicated implementations where a cleaner reframing could delete whole categories of complexity.
- Refactors that move code around but fail to reduce the number of concepts a reader must hold in their head.
- Any source file over 1000 lines.
- Conditionals bolted onto unrelated code paths.
- One-off booleans, nullable modes, or flags that complicate existing control flow.
- Feature-specific logic leaking into general-purpose modules.
- Generic "magic" handling that hides simple structure.
- Thin wrappers or identity abstractions that add indirection without simplifying anything.
- Unnecessary casts, `any`, `unknown`, or optional params that muddy the real contract.
- Copy-pasted logic instead of extracted helpers.
- Narrow edge-case handling implemented in the middle of an already busy function.
- Refactors that technically pass tests but make the code less modular or less readable.
- "Temporary" branching that has become permanent debt.
- Bespoke helpers where the codebase already has a canonical utility for the job.
- Logic added in the wrong layer/package when there is a clear canonical home.
- Sequential async flow where obviously independent work could be parallelized.
- Partial-update logic that leaves state less atomic than necessary.
- **Stale major-version dependencies.**
- **Direct dependencies whose usage no longer matches the maintainer-recommended pattern.**
- **Two dependencies covering the same role.**
- **Dependencies that could be deleted entirely.**

## Preferred Remedies

- Delete a whole layer of indirection rather than polishing it.
- Reframe the state model so conditionals disappear instead of getting centralized.
- Change the ownership boundary so a feature becomes a natural extension of an existing abstraction.
- Turn special-case logic into a simpler default flow with fewer exceptions.
- Extract a helper or pure function.
- Split a large file into smaller focused modules.
- Move feature-specific logic behind a dedicated abstraction.
- Replace condition chains with a typed model or explicit dispatcher.
- Separate orchestration from business logic.
- Collapse duplicate branches into a single clearer flow.
- Delete wrappers that do not meaningfully clarify the API.
- Reuse the existing canonical helper instead of introducing a near-duplicate.
- Make type boundaries more explicit so the control flow gets simpler.
- Move logic to the package/module/layer that already owns the concept.
- Parallelize independent work when that also simplifies the orchestration.
- Restructure related updates into a more atomic flow.
- **Upgrade dependencies to the current major and adopt the modern API.**
- **Replace a redundant dependency with the one already in the project.**
- **Replace a small dependency with the platform built-in.**

Do not be satisfied with "maybe rename this" feedback when the real issue is structural.

## Review Tone

Direct, serious, demanding about quality. Not rude, but do not soften major maintainability issues into mild suggestions. If the codebase is messier than its features warrant, say so clearly. If a path to a dramatic simplification was missed, say that too.

## Output Format

```
## Verdict
[CLEAN / NEEDS RESTRUCTURING / NEEDS MAJOR REWORK]

## Code-Judo Opportunities
- [Dramatic simplifications: what to delete, not just polish. Pointers to specific files / modules.]

## Structural Blockers
- [Files over 1k lines, spaghetti growth, boundary leaks, with file paths]

## Dependency Audit (context7)
- [pkg@current → recommended] [reason: stale major / deprecated API in use / duplicates X / unused / etc.]

## Abstraction / Type Cleanup
- [Wrappers, casts, optionality, leaked invariants, with file paths]

## Notes
- [Smaller maintainability concerns worth flagging]
```

Prioritize findings in this order:

1. Structural code-quality regressions
2. Missed opportunities for dramatic simplification / code-judo restructuring
3. Spaghetti / branching complexity
4. Dependency staleness or misuse with material impact
5. Boundary / abstraction / type-contract problems
6. File-size and decomposition concerns
7. Smaller dependency-hygiene issues
8. Legibility and maintainability concerns

Do not flood the report with low-value nits if there are larger structural issues. Prefer a smaller number of high-conviction comments over a long list of cosmetic notes.

## Approval Bar

A codebase passes nuclear-review when:

- No file exceeds 1000 lines without an explicit justification.
- No obvious code-judo move is sitting on the table.
- No spaghetti special-casing in shared flows.
- No thin wrappers or identity abstractions.
- No casts / `any` / `unknown` papering over an unclear invariant.
- No architecture-boundary leaks or duplicated canonical helpers.
- All direct dependencies are within one major of current.
- All direct dependencies are used in their maintainer-recommended modern form.
- No two dependencies duplicate roles.

If any of those fail, the report must include explicit, actionable feedback and push for the cleaner shape.

## Attribution

Structural rubric ported from [`cursor/plugins/cursor-team-kit/skills/thermo-nuclear-code-quality-review`](https://github.com/cursor/plugins/tree/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review). Reported by Eric Zakariasson as Cursor's most-used internal skill. The whole-codebase scope and context7 dependency audit are cc-settings additions.
