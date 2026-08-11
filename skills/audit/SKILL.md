---
name: audit
argument-hint: "[maintainability|codebase|docs|process|debt|threat-model]"
description: Whole-repo audits in six modes. Maintainability mode — structural audit of sprawl, thin wrappers, leaked logic, dependency freshness. Triggers "nuclear review", "thermonuclear review", "code judo", "deep code quality audit", "harsh maintainability review", "whole codebase review", "should this exist". Codebase/Docs/Process modes — adversarial audits hunting defects, drift, dead ends. Codebase triggers "adversarial audit", "fable audit", "expectation gaps", "correctness audit". Docs triggers "audit the docs", "docs audit", "doc drift". Process triggers "process audit", "audit the workflows", "walk the journeys", "end-to-end audit". Threat-model mode — repo-grounded abuse-path analysis, triggers "threat model", "STRIDE", "attack surface", "abuse paths". Debt mode ledgers `SHORTCUT:` markers — triggers "debt ledger", "shortcut ledger". Owns the bare "audit the codebase" — asks maintainability vs correctness when unpinned.
context: main
requires:
  - mcp: context7
---

# Audit

One skill, six whole-repo audit modes. Five of them share a skeleton: read the surface **in full** (never sample), hunt with explicit categories, and ship a prioritized, executable report. Three families of question:

- **Maintainability** — ported from Cursor's internal `thermo-nuclear-code-quality-review` skill (reported by Eric Zakariasson as Cursor's most-used internal skill; this mode was formerly the standalone `/nuclear-review` skill). Asks **should this code exist?** — structural quality, 1k-line sprawl, thin wrappers, code-judo deletions, dependency freshness via context7.
- **Codebase, Docs, and Process** — adapted from the fable audit goal-spec trio (gist `diegomarino/04970a2b8d9cc419de3ba05b9a03db5a`; these modes were formerly the standalone `/adversarial-audit` skill). Ask **does it do what it promises?** — correctness/coherence/affordances (codebase), truth and structure of the docs (docs), walkable end-to-end journeys (process). The July 2026 cc-settings audit ran the codebase spec and produced 28 findings, ~all confirmed and fixed. The mechanics that made that work (stable IDs, CONFIRMED/PLAUSIBLE, concrete failure scenarios, design tensions vs line findings, open questions for the maintainer) are the contract for these three modes, whatever the mode.
- **Threat-Model** — adapted from openai/skills `security-threat-model` (Apache-2.0). Asks **what can go wrong, and who would exploit it?** — trust boundaries, attacker capability, abuse paths tied to attacker goals, mitigations mapped to components.

Maintainability mode should push to be **ambitious** about code structure — do not merely identify local cleanup opportunities, actively search for "code judo" moves. The codebase, docs, process, and threat-model modes hold **no loyalty to the current design** — hunt defects, drift, dead ends, and abuse paths rather than confirm things work.

The sixth mode, **Debt**, is the odd one out: a mechanical grep that collects `SHORTCUT:` markers into a ledger. It shares none of the skeleton above and makes no judgement — see Mode: Debt at the end of this file.

## Mode Router — disambiguate before fanning out

If the invocation already pins a mode (see trigger phrases below), start there directly. If it doesn't — most commonly the bare phrase **"audit the codebase"** — this skill owns that ambiguity and must not guess: ask ONE question before doing anything else.

> "Do you want a **maintainability** audit (should this code exist — structure, code-judo restructuring, dependency hygiene) or a **correctness** audit (does it do what it promises — bugs, incoherences, affordance gaps)?"

Only proceed to the matching mode below once the answer disambiguates. This question is the entire point of merging the two prior skills into one — do not skip it to "be helpful."

**Trigger phrases by mode:**

| Mode | Phrases |
|---|---|
| Maintainability | "nuclear review", "thermonuclear review", "code judo", "deep code quality audit", "harsh maintainability review", "whole codebase review", "should this exist" |
| Codebase | "adversarial audit", "fable audit", "expectation gaps", "correctness audit" |
| Docs | "audit the docs", "docs audit", "doc drift" |
| Process | "process audit", "audit the workflows", "walk the journeys", "end-to-end audit" |
| Threat-Model | "threat model", "STRIDE", "attack surface", "abuse paths" |
| Debt | "debt ledger", "shortcut ledger", "what did we defer", "what corners did we cut" |
| Ambiguous — ASK | "audit the codebase" alone, or any phrasing that doesn't match a row above |

Debt and Threat-Model modes never participate in the ambiguity above — Debt is a
mechanical grep, and Threat-Model's trigger phrases (STRIDE, attack surface, abuse
paths) don't overlap anything else in this skill. Run Debt standalone or as a cheap
first pass before maintainability mode.

## When to use vs other review skills

- `/review` — per-diff Darkroom checklist (TypeScript / React / a11y / perf / security). Every change.
- `/audit` (this skill) — periodic whole-repo audit, six modes. Maintainability mode asks "should this code exist?"; codebase, docs, and process modes ask "does it do what it promises?"; threat-model mode asks "what can go wrong, and who would exploit it?"; debt mode asks "what did we defer on purpose?" Run maintainability and codebase mode on the same cadence (major version cuts, after extended velocity sprints, before a load-bearing migration) — they compose well back-to-back since they hunt different game. Docs and process modes shine before releases and after feature bursts. Threat-model mode fits before a security-sensitive launch or a new internet-facing surface.
- `/zero-tech-debt` — rework a specific patch to its intended end-state. Not a review — it edits.
- `/verify` — adversarial check of a single change/claim, not a repo sweep.

A typical sequence: `/audit maintainability` produces findings → engineers cherry-pick the highest-leverage ones → `/zero-tech-debt` or `/refactor` to execute.

> **Tip (Claude Code v2.1.154+)**: run `/effort ultracode` before invoking this skill. Whole-repo audits are the canonical shape that benefits from dynamic workflows — phase state lives in the workflow script rather than Claude's context window, individual areas can be reviewed in parallel (up to 16 concurrent), and the run can resume from cached agent results within the session. Dynamic workflows default to a medium size guideline, aiming for fewer than 15 agents (v2.1.219) — it's advisory, not enforced, but a repo with more modules than that is worth raising `workflowSizeGuideline` for explicitly before the fan-out phase rather than silently exceeding the default.
>
> A ready-made example for maintainability mode ships at `references/nuclear-review.workflow.js` (installed to `~/.claude/skills/audit/references/`). It is **opt-in, not a dependency** — the mode above works with no Workflow tool. Run it with `Workflow({ scriptPath: "~/.claude/skills/audit/references/nuclear-review.workflow.js" })`, or copy it into `.claude/workflows/`. It maps the repo, fans out one structural reviewer per module, audits dependencies, and synthesizes one report. Treat it as a **template** — adapt its module list, schemas, and phases to the repo at hand rather than running it verbatim.

---

## Mode: Maintainability

An unusually strict **whole-codebase** maintainability audit. Reviews implementation quality, abstraction quality, structural simplification opportunities, **and** dependency freshness + usage quality.

Cursor's version targets a single PR diff; this version targets the entire repository and adds a context7-driven dependency audit on top, because the same questions ("is this the right abstraction?", "is this thin wrapper earning its keep?") apply equally to library choices.

### Scope

The audit covers the **entire codebase**, not the current diff. That includes:

- All source modules — application code, libraries, scripts, hooks, configs
- The dependency manifest (`package.json` + lockfile) — every direct dependency
- Folder structure and module boundaries
- Top-level architectural surfaces (routes, providers, exported APIs)

Skip vendored code, generated files, and `node_modules`.

### Workflow

#### Phase 0 — Map the codebase

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

If `dead` returns `unsupported-by-native-engine` (the default engine does not implement it), say
the dead-code pass did not run — do not record "no dead code" as a finding. An empty result from
`dead` or `impact` is not evidence; confirm with `Grep` before acting on it.

If the opt-in `tldr-code` CLI is installed (`~/.claude/code-intel/tldr-code/0.4.0/tldr` — see
`docs/tldr-cheatsheet.md`), prefer it for the dead-code pass instead:

```bash
~/.claude/code-intel/tldr-code/0.4.0/tldr dead . --lang typescript
```

It **exits 0 even on errors** — never trust its exit code. Check that stdout parses as JSON and
that `functions_analyzed > 0`; non-JSON stdout or `functions_analyzed: 0` means the scan did not
run and must be reported as "scan unavailable", never as "no dead code". **`dead_functions` from
`tldr-code` is ADVISORY ONLY — confirm every candidate with `Grep` before recording it as a
finding.** Its MCP path (`tldr-mcp`, not used here) was measured reporting live symbols as dead
code; the CLI was measured accurate, which is why it's used here instead.

#### Phase 1 — Dependency audit (context7)

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

#### Phase 2 — Structural audit

Apply the non-negotiable standards below to the codebase as a whole. Walk the largest files first, then the modules with the most outbound dependencies, then the entry points.

#### Phase 2b — Cross-model structural pass (when the Codex bridge is available)

Run the shared cross-model procedure (`references/audit-contract.md` §1) with this mode's audit prompt:

```bash
bun "$HOME/.claude/src/scripts/codex-run.ts" ask "Audit this repository for structural problems: files over ~1000 lines, thin wrappers that don't earn their keep, logic leaked across boundaries, and duplicated abstractions. Walk the largest files and the modules with the most outbound dependencies first. Report the highest-leverage 'code judo' restructurings — ones that delete whole branches rather than rearrange them — ordered by conviction."
```

Fold Codex's findings into Phase 3 per the contract: convergence = high-conviction, divergence noted not dropped, gated and fails open.

#### Phase 2c — team-knowledge reconciliation (when the corpus is reachable)

Phases 2 and 2b judge structure intent-blind, so deliberate design reads as debt. Run the shared reconciliation procedure — `references/audit-contract.md` §2: generate findings blind FIRST, then cross-reference the corpus; a documented decision **reclassifies severity, never suppresses a finding**; gated, fails open.

#### Phase 3 — Synthesis

Produce the output in the format below. Prioritize ruthlessly — a smaller number of high-conviction findings beats a long list.

#### Phase 4 — Documentation updates (after fixes land)

A maintainability audit that produces fixes but leaves the docs stale is half-done. Whenever findings from this mode turn into code changes, the same pass must touch the docs that describe them. If you only produce the report (no fixes in this session), skip this phase — but flag it for whoever applies the fixes.

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
- **One short paragraph per entry**, naming the file(s) changed and the why. The global Action-First rules (installed CLAUDE.md) apply to doc artifacts too — no padding, no victory laps.
- **Regenerate derived docs.** If you changed a zod schema in `src/schemas/`, run `bun run schemas:emit` and commit the resulting `schemas/*.schema.json` diff alongside the source change.
- **Update `MANUAL.md` triggers tables** when a skill's invocation phrasing changes or when a new skill goes in.

Verify the doc pass landed correctly before finishing:

```bash
bun run lint:skills            # frontmatter sanity
bun run schemas:check          # derived schemas in sync with sources
git diff --stat HEAD~N HEAD    # confirm doc files are in the diff
```

### Non-Negotiable Standards

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

### Primary Review Questions

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

### What to Flag Aggressively

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

### Preferred Remedies

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

### Review Tone

Direct, serious, demanding about quality. Not rude, but do not soften major maintainability issues into mild suggestions. If the codebase is messier than its features warrant, say so clearly. If a path to a dramatic simplification was missed, say that too.

### Output Format

Report mechanics: follow the shared finding contract (`references/audit-contract.md` §3) — stable IDs (`N1`, `N2`, … in severity order), CONFIRMED vs PLAUSIBLE, disprove-first, concrete scenarios, considered-&-rejected ledger.

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

## Documented / By-Design (verify still current)
- [Findings that contradict a team-knowledge decision — escalated for team discussion, NOT auto-fixed. Cite the note; flag if the decision looks stale.]

## Considered / Rejected
- [Candidate findings investigated and disproved, one-line reason each — the ledger future reviews check first so disproved findings aren't re-litigated.]

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

### Approval Bar

A codebase passes this mode when:

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

### Attribution

Structural rubric ported from [`cursor/plugins/cursor-team-kit/skills/thermo-nuclear-code-quality-review`](https://github.com/cursor/plugins/tree/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review). Reported by Eric Zakariasson as Cursor's most-used internal skill. The whole-codebase scope and context7 dependency audit are cc-settings additions.

---

## Shared Contract (Codebase, Docs, Process, and Threat-Model modes)

**Role.** No loyalty to the current design/structure/flows. Act simultaneously as a senior staff engineer, a skeptical first-time consumer, and an adversarial reviewer. Understand deeply enough to challenge, not merely validate.

**Method.**
- Per area, state how it SHOULD behave, then read (or run) to confirm or refute. Every expectation-vs-reality gap is a finding.
- Every finding needs a concrete scenario: specific inputs/state leading to the wrong or surprising result. No vague "could be improved."
- Mark each finding **CONFIRMED** (traced or reproduced) or **PLAUSIBLE** (suspected). Try to disprove yourself first; discard findings that don't survive.
- Where something is sound, say so once and move on — spend effort where it isn't.

**Cross-model + intent passes.** Run the shared procedures in `references/audit-contract.md` (§1 Codex cross-model pass via `codex-verifier` on the finding list, §2 team-knowledge reconciliation). Both gated, both fail open — unavailable means proceed Claude-only. The one-line invariants: reconcile AFTER findings exist, and a documented decision **reclassifies severity, never deletes a finding**.

**Output.** Write the full report to `docs/audits/[mode]-audit-YYYY-MM-DD.md` (create the dir; leave uncommitted — the maintainer owns git). Structure top-heavy:
1. Summary table: ID | severity | area | one-line issue | file:line | CONFIRMED/PLAUSIBLE.
2. Map (system map / doc map / process state machine — per mode below).
3. Findings by hunt category, severity order. Each: stable ID (H1/M1/L1 by severity, or C/D/P prefix per mode), location, one-line issue, concrete scenario, status, recommended direction.
4. Design tensions: the 3-5 deepest structural issues ("the approach, not a line"), each with the alternative you'd weigh.
5. Open questions: what the artifact alone can't resolve — maintainer answers required.
6. Considered & rejected: candidate findings you investigated and disproved (or reclassified as by-design), each with a one-line reason. This ledger is what stops the next audit from re-litigating them — check it before hunting.

Chat reply = exec summary only: counts by severity + top 3-5 findings + report path.

**Optional issue filing.** When the maintainer wants findings executable by agents, file each as a GitHub issue (one per finding, severity labels, CONFIRMED/PLAUSIBLE in the body, an epic for the design tensions, `question`-labeled issues for the open questions). This is how the July 2026 cc-settings remediation ran: issues → parallel fix agents → PRs citing the IDs.

## Mode: Codebase

Exhaustive adversarial audit of the code — defects, design incoherences, unexpected affordances, doc drift, and mismatches between what the code invites you to do and what it actually does.

**Scope.** Read the codebase in full. Build a model of: entry points and real (not documented) execution paths; module boundaries and their explicit/implied contracts; data models, invariants, and where they're enforced vs assumed; external surfaces (APIs, CLIs, config, env vars, file formats, network calls); the onboarding path a newcomer would actually follow.

**Hunt for (beyond bugs):**
1. **Correctness** — logic errors, races, off-by-one, unhandled edges, silently swallowed failures, wrong error propagation.
2. **Alternative/unintended paths** — second call? concurrent calls? empty/null/huge input? partial failure mid-op? retries? the "holding it wrong" path?
3. **Incoherences** — names that lie about behavior, two modules solving one problem differently, config honored here and ignored there, duplicated sources of truth that can drift, dead code, contradictory defaults.
4. **Affordance mismatches** — "I expected to do X this way but can't, or it does something else." Where does the API shape promise a capability the code doesn't deliver? Where is the easy path also the dangerous one?
5. **Missing functionality** — what a reasonable user expects (validation, idempotency, cleanup, observability, cancellation, timeouts) but is absent.
6. **Boundary and safety** — leaky abstractions, invariants in the wrong layer, unvalidated input crossing a boundary; injection, path traversal, unbounded growth, resource leaks, missing authz, exposed secrets — only where real.
7. **Documentation** — README/docstrings/comments that are wrong, stale, or contradict the code; undocumented public behavior/params/errors/side effects; examples that wouldn't run.
8. **Developer experience** — can a newcomer build, run, test, and debug from the docs alone? Confusing errors, silent misconfig, setup footguns.

**Map section:** architecture, real execution paths, key invariants — so the maintainer can check your understanding. Also include an "expectation gaps" list: short "expected X, found Y" entries for affordance/docs/DX.

## Mode: Docs

Audit documentation as a first-class artifact: does it tell the truth about the code, lead with what matters, size documents so detail can breathe, and draw processes instead of narrating them?

**Role additions:** a docs lead who owns information architecture; a newcomer with only the docs and a terminal; a returning maintainer hunting one fact; an autonomous agent using the docs as its only spec.

**Scope.** Every reader-facing surface in full: README, docs/, ADRs, CONTRIBUTING/onboarding, public docstrings, CLI help, config comments, example scripts, every diagram (source + rendered). Build the current doc map: what exists, what it claims to cover, who it's for, how a reader finds it.

**Hunt for:**
1. **Drift/inaccuracy (primary)** — any claim the code no longer honors: renamed/removed commands, flags, env vars, paths, defaults; examples that don't run; output samples that don't match. And the inverse: real public behavior no document mentions.
2. **Inverted-pyramid violations** — docs that bury the point. Each doc should open with "what this is / when you'd reach for it" plus the 20% answering 80% of questions; reference tables and rationale at the end.
3. **Sizing/decomposition** — documents where concerns collide: recommend the split (sections, names, back-links). Also scattered fragments that should merge.
4. **Architecture as drawn process** — flow/lifecycle/interaction explained in prose that a diagram would carry better. Prefer Mermaid: flowchart for control flow, sequence for cross-component calls, stateDiagram for lifecycles.
5. **Usefulness/audience fit** — does each doc serve a real reader task? Are tutorial/how-to/reference/explanation modes mixed to nobody's benefit? Does it answer "why"?
6. **Coverage** — public surfaces with no docs; missing troubleshooting/runbook; non-obvious decisions with no ADR.
7. **Single source of truth** — the same fact in N places that will drift; pick the canonical home, link the rest.
8. **Findability** — can a reader route to the right doc without knowing where it lives? Missing index, orphans, dead cross-links.

**Method addition:** for every accuracy claim, check against reality — run the example, confirm the flag exists, diff the sample output. CONFIRMED means verified against code or a run.

**Extra output sections:** doc map current-vs-proposed (proposed tree = purpose + audience per doc + the splits/merges, executable directly); drift-verification list (finding + exact check run + result); diagram backlog (draft actual Mermaid for the top 3-5, naming target doc + location); missing-docs backlog prioritized by unblocking value.

## Mode: Process

Audit end-to-end workflows — not lines of code, but whether the processes the product promises compose into complete, walkable journeys. Find holes, dead ends, missing transitions, and steps where a user or agent gets stranded.

**Role.** Walk every documented journey twice: once as a first-time human following only the docs, once as an autonomous agent chaining commands via exit codes and JSON.

**Scope.** Enumerate the product's documented journeys (onboarding/install, the core lifecycle(s), review/approve loops, publish/deploy, cleanup) and walk each **empirically in throwaway workspaces** under a gitignored scratch dir — never against real state. Fake heavyweight external tools with PATH shims where needed.

**Hunt for:**
1. **Dead ends** — states with no exit command, fixable only by hand-editing files.
2. **Missing processes** — steps the docs promise that no command implements.
3. **Re-run/second-call semantics** — every mutating command run twice, out of order, and against a half-completed prior run. Idempotency AND exit codes.
4. **Partial failure** — kill mid-operation, unwritable targets, collisions with pre-existing artifacts.
5. **Agent ergonomics** — can an agent distinguish "my operation failed" from "unrelated warning elsewhere"? JSON contract stability, help text vs actual flags, error parseability.
6. **Docs/process drift** — walk the quickstart/process docs command-by-command against reality.
7. **Concurrency** — two invocations against the same workspace.
8. **Cross-process coherence** — enumerate every state a record/artifact can occupy across subsystems and check a command moves each state forward.

**Map section:** the real per-record state machine — states, transitions, owning command; mark unreachable states and absorbing dead ends. If a prior audit was remediated, start by empirically verifying those fixes hold through full workflows (regressions and partial fixes are in scope; re-auditing code style is not).

**Method addition:** every finding needs the exact command sequence to reproduce and the resulting state/output. CONFIRMED means reproduced, not traced.

## Mode: Threat-Model

Repo-grounded STRIDE-style threat modeling: enumerate trust boundaries, assets, attacker capabilities, and abuse paths for a repo or path, then write a standing threat-model document. Adapted from openai/skills `security-threat-model` (Apache-2.0).

**Role.** An AppSec reviewer who has actually read this codebase — every architectural claim is anchored to code you can cite, and every assumption is stated rather than silently guessed.

**Scope.** The target repo or path. Extract components, data stores, and entry points; separate what actually runs in production from build/test tooling. Note the deployment model, internet exposure, and auth expectations where the repo makes them explicit — everything else is an assumption to confirm below.

**Hunt for:**
1. **Trust boundaries and assets** — every point where data crosses from lower to higher trust (network → app, user → privileged, tenant → shared store); catalog the risk-driving assets — credentials, tokens, PII, payment data.
2. **Attacker capability calibration** — what a realistic attacker can and cannot do given the exposure and deployment model. State non-capabilities explicitly ("no physical access, no insider access") — an uncalibrated attacker inflates every finding downstream.
3. **Abuse paths** — concrete paths tied to attacker goals: exfiltration, privilege escalation, integrity compromise, denial of service. Each path names the entry point, the boundary crossed, and the asset at risk — never a generic "could be exploited."
4. **Severity** — qualitative likelihood × impact per abuse path, with the reasoning written out. No inflated severity: a theoretical path with no realistic attacker capability is Low, not High.

**Map section:** a trust-boundary diagram (Mermaid flowchart — same preference as Docs mode) plus the asset inventory.

**Method addition:** before finalizing, pause and ask the user anything load-bearing the repo alone can't answer — deployment model, scale, auth scheme, internet exposure, data sensitivity, multi-tenancy. Those answers reshape severity, so resolve them before writing mitigations, not after.

**Extra output:** mitigations mapped one-to-one to the components/boundaries they protect, never a generic hardening checklist; and a QA pass confirming every entry point, boundary, and assumption is accounted for before delivery. Uses the same `docs/audits/threat-model-audit-YYYY-MM-DD.md` output path and stable-ID contract as Codebase/Docs/Process modes (Shared Contract, above).

---

## Mode: Debt

Collect every deliberate shortcut in the repo into one ledger, so a deferral can't
quietly become permanent. Unlike the other five modes this one is mechanical: it
greps for markers and reports what it finds. It makes no judgement about whether
the shortcut was right.

The `SHORTCUT:` convention is defined in `AGENTS.md` (Laziness Ladder). Every
deliberate simplification carries a ceiling and an upgrade trigger:

```ts
// SHORTCUT: single global lock, not per-key.
// ceiling: contention above ~50 rps
// upgrade: shard by key hash when p99 write latency climbs
```

### Scan

```bash
bun run lint:shortcuts --json
```

Falls back to a raw grep when the script isn't available (external or client repos):

```bash
grep -rnE '(#|//|--|;) ?SHORTCUT:' . \
  --exclude-dir={node_modules,.git,dist,build,.next,vendor,target}
```

Add comment prefixes for any other languages in the tree. The prefix requirement is
deliberate: it keeps prose that merely mentions the convention (this file included)
out of the ledger.

### Output

One row per marker, grouped by file, newest-first within a file:

```
<file>:<line>  <what was simplified>
               ceiling: <the limit named>
               upgrade: <the trigger to revisit>   |   [no-trigger]
```

Tag any marker with no `upgrade:` line `[no-trigger]` and list those first. Those
are the ones that rot — nobody knows what would make them worth fixing, so nobody
ever does. Add `git blame -L<line>,<line>` per row when the user asks for owners.

End with: `<N> markers, <M> with no trigger.` Nothing found: `No SHORTCUT: debt. Clean ledger.`

### Boundaries

Reads and reports only — never edits, never implements a marker. A `SHORTCUT:` is
not a TODO to clear on sight (see `AGENTS.md` → TODO Comments Are Instructions); it
comes out only when its trigger has actually fired, and then via `/zero-tech-debt`
or `/refactor`, not here.

**No invented savings.** Report the count of markers and what each defers. Never
print a "you saved N lines by deferring these" figure — the built version was never
written, so there is no baseline to subtract from. Counted markers are real; an
extrapolated saving is not.

To persist the ledger, ask first, then write it to `SHORTCUT-DEBT.md`.
