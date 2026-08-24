---
name: audit
argument-hint: "[codebase|docs|process|performance|debt|threat-model|motion|seo]"
description: Eight whole-repo audit modes. Codebase covers structure + correctness and owns bare "audit the codebase". Triggers "nuclear review", "code judo", "whole codebase review", "adversarial audit", "fable audit", "correctness audit". Docs/process covers drift + walkable journeys. Triggers "audit the docs", "doc drift", "process audit". Performance requires measured findings. Triggers "perf audit", "why is it slow", "bundle audit". Threat-model covers abuse/STRIDE. Triggers "threat model", "attack surface". Motion covers animation. Triggers "motion audit". SEO covers discoverability/AEO. Triggers "seo audit", "aeo", "answer engine", "llms.txt". Debt inventories `SHORTCUT:`. Triggers "debt ledger", "shortcut ledger". Single-page CWV fix loops route to /lighthouse.
context: main
requires:
  - mcp: context7
---

# Audit

## Standalone Codex host branch

Claude frontmatter, TLDR, agent teams, dynamic workflows, `codex-verifier`, and
`codex-run.ts` do not apply in standalone Codex. Keep source inspection
read-only. Map with `rg --files`, `rg -n`, direct import/caller searches, focused
file reads, and the repo's own diagnostics; never claim TLDR ran. Use Context7
only when the user configured that MCP. Otherwise inspect pinned manifests and
lockfiles, consult official package documentation through native browsing when
available, and label currency or API claims unverified when neither source is
reachable. This package does not auto-run unpinned registry MCP packages.

For fan-out, create each new reader with `spawn_agent`, continue a live reader
with `send_message`, trigger another turn for an idle existing reader with
`followup_task`, wait with `wait_agent`, and stop its current turn with
`interrupt_agent` only when necessary. Only read-only reviewers
may overlap. Writers share the working tree unless the live host explicitly
offers isolation, so the main session writes the final report after readers
finish; any implementer and test-writer phases must be serialized with
non-overlapping ownership.

One skill, eight whole-repo audit modes. Seven of them share a skeleton: read the surface **in full** (never sample), hunt with explicit categories, and ship a prioritized, executable report or plan set. Six families of question:

- **Codebase** — one merged audit, two lenses on the same read. The **structure lens** (ported from Cursor's internal `thermo-nuclear-code-quality-review` skill, reported by Eric Zakariasson as Cursor's most-used internal skill; formerly this skill's standalone Maintainability mode) asks **should this code exist?** — 1k-line sprawl, thin wrappers, code-judo deletions, dependency freshness via context7. The **behavior lens** (adapted from the fable audit goal-spec trio, gist `diegomarino/04970a2b8d9cc419de3ba05b9a03db5a`; formerly the separate Codebase mode) asks **does it do what it promises?** — correctness, incoherences, affordance gaps. Merged August 2026: both modes fanned the same whole-repo readers over the same files and shipped near-identical reports, so they now run as one pass with two hunt lists. The July 2026 cc-settings audit ran the behavior lens and produced 28 findings, ~all confirmed and fixed.
- **Docs and Process** — from the same fable audit trio. Truth and structure of the docs (docs), walkable end-to-end journeys (process). The mechanics that made the July 2026 audit work (stable IDs, CONFIRMED/PLAUSIBLE, concrete failure scenarios, design tensions vs line findings, open questions for the maintainer) are the contract for these modes.
- **Performance** — asks **where is time actually going, measured?** Empirical-only: a finding does not exist until a number confirms it. Covers client runtime (via the same Lighthouse protocol `/lighthouse` uses), bundle and build, server and data, and code-level hot paths, adapting to what the repo actually is (web app vs CLI vs library).
- **Threat-Model** — adapted from openai/skills `security-threat-model` (Apache-2.0). Asks **what can go wrong, and who would exploit it?** — trust boundaries, attacker capability, abuse paths tied to attacker goals, mitigations mapped to components.
- **Motion** — adapted from emilkowalski/skills `improve-animations` (MIT). Asks **where does animation work have the highest leverage?** — purpose/frequency, easing/duration, physicality/origin, interruptibility, performance, accessibility, cohesion, and missed opportunities, turned into self-contained implementation plans rather than a findings report.
- **SEO** — distilled from shipped Darkroom work (satus PRs #348/#405/#413 and darkroomengineering/website PRs #40/#65, which converged independently on the same architecture). Asks **will this site be found, ranked, and cited?** — canonical integrity, sitemap reachability, per-content metadata, structured data, and the AEO surfaces (llms.txt, named AI crawlers, machine-view routes) that answer engines read.

Codebase mode's structure lens should push to be **ambitious** — do not merely identify local cleanup opportunities, actively search for "code judo" moves. Every adversarial mode holds **no loyalty to the current design** — hunt defects, drift, dead ends, and abuse paths rather than confirm things work.

The eighth mode, **Debt**, is the odd one out: a mechanical grep that collects `SHORTCUT:` markers into a ledger. It shares none of the skeleton above and makes no judgement — see Mode: Debt at the end of this file.

## Mode Router

The bare phrase **"audit the codebase"** routes straight to Codebase mode — the merge removed the old maintainability-vs-correctness question, because one pass now carries both lenses.

**Trigger phrases by mode:**

| Mode | Phrases |
|---|---|
| Codebase | "audit the codebase", "nuclear review", "thermonuclear review", "code judo", "deep code quality audit", "harsh maintainability review", "whole codebase review", "should this exist", "adversarial audit", "fable audit", "expectation gaps", "correctness audit" |
| Docs | "audit the docs", "docs audit", "doc drift" |
| Process | "process audit", "audit the workflows", "walk the journeys", "end-to-end audit" |
| Performance | "perf audit", "performance audit", "why is the app slow", "bundle audit", "build is slow", "speed audit" |
| Threat-Model | "threat model", "STRIDE", "attack surface", "abuse paths" |
| Motion | "motion audit", "audit the animations", "improve the animations" |
| SEO | "seo audit", "aeo", "ai engine optimization", "answer engine", "discoverability audit", "rank better", "llms.txt" |
| Debt | "debt ledger", "shortcut ledger", "what did we defer", "what corners did we cut" |

One remaining ambiguity, Performance vs `/lighthouse`: a page-speed ask scoped to a URL or a target score ("check page speed on /", "improve web vitals", "get LCP under 2.5s") is `/lighthouse` — it measures one page and loops fixes until targets are met. A repo-wide ask ("performance audit", "why is the app slow") is this skill's Performance mode — it measures every surface and ships a report. When the phrasing genuinely fits both, ask which the user wants; don't guess.

Debt mode is a mechanical grep — run it standalone or as a cheap first pass before Codebase mode.

## When to use vs other review skills

- `/review` — per-diff Darkroom checklist (TypeScript / React / a11y / perf / security), now including an animation checklist when the diff touches motion. Every change.
- `/audit` (this skill) — periodic whole-repo audit, eight modes. Codebase mode asks "should this code exist, and does it do what it promises?"; docs and process modes ask whether the docs tell the truth and the journeys walk end-to-end; performance mode asks "where is time actually going, measured?"; threat-model mode asks "what can go wrong, and who would exploit it?"; motion mode asks "where does the animation work have the highest leverage?"; seo mode asks "will this site be found, ranked, and cited?"; debt mode asks "what did we defer on purpose?" Run codebase mode on major version cuts, after extended velocity sprints, before a load-bearing migration. Docs and process modes shine before releases and after feature bursts. Performance mode fits before a launch, after a dependency-heavy sprint, or whenever "the site feels slow" comes up without a number attached. Threat-model mode fits before a security-sensitive launch or a new internet-facing surface. Motion mode fits after a UI-heavy sprint or before a client showcase. SEO mode fits before a site launch and as a first pass on any client marketing/content site.
- `/lighthouse` — single-page CWV measurement plus a fix-until-targets-met loop. Performance mode delegates its client-runtime measurements to the same Lighthouse protocol and hands findings back to `/lighthouse` or `/refactor` for execution; it never duplicates the loop.
- `/zero-tech-debt` — rework a specific patch to its intended end-state. Not a review — it edits.
- `/verify` — adversarial check of a single change/claim, not a repo sweep.

A typical sequence: `/audit codebase` produces findings → engineers cherry-pick the highest-leverage ones → the right executor by finding type: dead code and duplication go to the `deslopper` agent (auto-removes what's provably dead, stages consolidations for approval), structural rework to `/zero-tech-debt` or `/refactor`, client-runtime perf findings to `/lighthouse`.

> **Claude Code only (v2.1.154+)**: standalone Codex skips this tip and the
> Workflow command below. In Claude, run `/effort ultracode` before invoking
> this skill. Whole-repo audits are the canonical shape that benefits from dynamic workflows — phase state lives in the workflow script rather than Claude's context window, individual areas can be reviewed in parallel (up to 16 concurrent), and the run can resume from cached agent results within the session. Dynamic workflows default to a medium size guideline, aiming for fewer than 15 agents (v2.1.219) — it's advisory, not enforced, but a repo with more modules than that is worth raising `workflowSizeGuideline` for explicitly before the fan-out phase rather than silently exceeding the default.
>
> A ready-made example for codebase mode's structure lens ships at `references/nuclear-review.workflow.js` (installed to `~/.claude/skills/audit/references/`). It is **opt-in, not a dependency** — the mode works with no Workflow tool. Run it with `Workflow({ scriptPath: "~/.claude/skills/audit/references/nuclear-review.workflow.js" })`, or copy it into `.claude/workflows/`. It maps the repo, fans out one structural reviewer per module, audits dependencies, and synthesizes one report. Treat it as a **template** — adapt its module list, schemas, and phases to the repo at hand rather than running it verbatim.

---

## Shared Contract (Codebase, Docs, Process, Threat-Model, SEO, and Performance modes)

**Role.** No loyalty to the current design/structure/flows. Act simultaneously as a senior staff engineer, a skeptical first-time consumer, and an adversarial reviewer. Understand deeply enough to challenge, not merely validate.

**Method.**
- Per area, state how it SHOULD behave, then read (or run) to confirm or refute. Every expectation-vs-reality gap is a finding.
- Every finding needs a concrete scenario: specific inputs/state leading to the wrong or surprising result. No vague "could be improved."
- Mark each finding **CONFIRMED** (traced or reproduced) or **PLAUSIBLE** (suspected). Try to disprove yourself first; discard findings that don't survive. (Performance mode tightens this: PLAUSIBLE does not exist there — see its evidence rule.)
- Where something is sound, say so once and move on — spend effort where it isn't.

**Cross-model + intent passes.** In Claude, run the shared procedures in
`references/audit-contract.md` (§1 Codex cross-model pass via `codex-verifier`
on the finding list, §2 team-knowledge reconciliation). Both are gated and fail
open. Standalone Codex never uses the bridge; it may use a fresh native
read-only reviewer under the lifecycle above. The one-line invariants: reconcile
AFTER findings exist, and a documented decision **reclassifies severity, never
deletes a finding**.

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

One merged audit, two lenses on one whole-repo read: **structure** (should this code exist?) and **behavior** (does it do what it promises?). Rides the Shared Contract above.

### Scope

The **entire codebase**, not the current diff:

- All source modules — application code, libraries, scripts, hooks, configs
- The dependency manifest (`package.json` + lockfile) — every direct dependency
- Folder structure, module boundaries, top-level architectural surfaces (routes, providers, exported APIs)
- Entry points and real (not documented) execution paths; module contracts, explicit and implied
- Data models, invariants, and where they're enforced vs assumed
- External surfaces (APIs, CLIs, config, env vars, file formats, network calls) and the onboarding path a newcomer would actually follow

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

In Claude, if the project uses `tldr`, prefer it for the call graph + dead-code pass. Standalone Codex skips these commands and uses the native searches in its host branch:

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

When the project depends on `deslop-cli` (check `package.json` — it's the same advisory probe
`/proof-of-work` runs), add it as a second dead-code signal: `npx deslop-cli`. Same rule as
tldr-code: advisory only, Grep-confirm every candidate. Two scanners agreeing upgrades conviction;
either one alone still needs confirmation.

#### Phase 1 — Dependency audit (Context7 when configured)

For each direct dependency in `package.json`, use the `context7` MCP server to
verify when it is configured. Standalone Codex otherwise uses the native/manual
fallback in its host branch and does not execute an unpinned registry MCP:

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

#### Phase 2 — The hunt, both lenses

Walk the largest files first, then the modules with the most outbound dependencies, then the entry points. Apply both lists to every meaningful surface in one pass.

**Structure lens — non-negotiable standards:**

0. **Be ambitious about structural simplification.** Do not stop at "this could be a bit cleaner." Look for reframings that make whole branches, helpers, modes, conditionals, or layers disappear entirely. Assume there is often a "code judo" move available — a re-organization that uses the existing architecture more effectively and makes the surface dramatically simpler. Prefer the solution that feels inevitable in hindsight; if you see a path to delete complexity rather than rearrange it, push hard for that path.
1. **Flag every file over 1k lines.** A strong code-quality smell by default; prefer extracting helpers, subcomponents, or modules. Waive only for a compelling structural reason with the file still clearly organized.
2. **Do not tolerate spaghetti.** Ad-hoc conditionals, scattered special cases, one-off branches in otherwise cohesive flows — a design problem, not a stylistic nit. Push logic into a dedicated abstraction, helper, state machine, or module instead of tangling existing paths.
3. **Bias toward cleaning the design, not preserving working code.** If behavior can stay the same while structure gets meaningfully cleaner, push for the cleaner version. Prefer simplifications that remove moving pieces over refactors that spread the same complexity around.
4. **Prefer direct, boring code over hacky or magical code.** Flag thin abstractions, identity wrappers, pass-through helpers, and generic mechanisms that hide simple data-shape assumptions.
5. **Push hard on type and boundary cleanliness.** Question unnecessary optionality, `unknown`, `any`, cast-heavy code, and silent fallbacks papering over unclear invariants; prefer explicit typed models and shared contracts.
6. **Keep logic in the canonical layer and reuse existing helpers.** Call out feature logic leaking into shared paths, details leaking through APIs, and bespoke one-offs where a canonical utility exists.
7. **Treat unnecessary sequential orchestration and non-atomic updates as design smells.** Serialized-for-no-reason work and updates that can leave state half-applied — flag both without over-indexing on micro-optimizations.
8. **Dependencies must be current and well-used.** Flag deprecated majors, superseded usage patterns, role-duplicating deps, disproportionate footprints, and deps a platform primitive could replace.

**Behavior lens — hunt categories:**

1. **Correctness** — logic errors, races, off-by-one, unhandled edges, silently swallowed failures, wrong error propagation.
2. **Alternative/unintended paths** — second call? concurrent calls? empty/null/huge input? partial failure mid-op? retries? the "holding it wrong" path?
3. **Incoherences** — names that lie about behavior, two modules solving one problem differently, config honored here and ignored there, duplicated sources of truth that can drift, dead code, contradictory defaults.
4. **Affordance mismatches** — "I expected to do X this way but can't, or it does something else." Where does the API shape promise a capability the code doesn't deliver? Where is the easy path also the dangerous one?
5. **Missing functionality** — what a reasonable user expects (validation, idempotency, cleanup, observability, cancellation, timeouts) but is absent.
6. **Boundary and safety** — leaky abstractions, invariants in the wrong layer, unvalidated input crossing a boundary; injection, path traversal, unbounded growth, resource leaks, missing authz, exposed secrets — only where real.
7. **Documentation** — README/docstrings/comments that are wrong, stale, or contradict the code; undocumented public behavior/params/errors/side effects; examples that wouldn't run.
8. **Developer experience** — can a newcomer build, run, test, and debug from the docs alone? Confusing errors, silent misconfig, setup footguns.

#### Phase 2b — Claude-only cross-model structural pass (when the Codex bridge is available)

Standalone Codex skips this phase. In Claude, run the shared cross-model
procedure (`references/audit-contract.md` §1) with this mode's audit prompt:

```bash
bun "$HOME/.claude/src/scripts/codex-run.ts" ask "Audit this repository for structural problems: files over ~1000 lines, thin wrappers that don't earn their keep, logic leaked across boundaries, and duplicated abstractions. Walk the largest files and the modules with the most outbound dependencies first. Report the highest-leverage 'code judo' restructurings — ones that delete whole branches rather than rearrange them — ordered by conviction."
```

Fold Codex's findings into Phase 3 per the contract: convergence = high-conviction, divergence noted not dropped, gated and fails open.

#### Phase 2c — team-knowledge reconciliation (when the corpus is reachable)

Phases 2 and 2b judge structure intent-blind, so deliberate design reads as debt. Run the shared reconciliation procedure — `references/audit-contract.md` §2: generate findings blind FIRST, then cross-reference the corpus; a documented decision **reclassifies severity, never suppresses a finding**; gated, fails open.

`SHORTCUT:` markers (AGENTS.md Laziness Ladder) get the same treatment as team-knowledge notes: a marked deferral is a documented decision, not ordinary debt — cite the marker instead of re-litigating it, and escalate only if its stated upgrade trigger has actually fired. Debt mode owns the full ledger; this mode just respects it.

#### Phase 3 — Synthesis

Produce the Shared Contract report, with two mode-specific additions: open with a one-line verdict — **CLEAN / NEEDS RESTRUCTURING / NEEDS MAJOR REWORK** — and lead the findings with a **Code-Judo Opportunities** section (dramatic simplifications: what to delete, not just polish). The map section includes an "expectation gaps" list: short "expected X, found Y" entries for affordance/docs/DX. Prioritize ruthlessly — a smaller number of high-conviction findings beats a long list; do not flood the report with nits when larger structural issues exist.

Severity ordering within the report: structural regressions and missed code-judo moves first, then correctness/incoherence findings, then dependency staleness with material impact, then boundary/type-contract problems, then file-size and legibility concerns.

#### Phase 4 — Documentation updates (after fixes land)

An audit that produces fixes but leaves the docs stale is half-done. Whenever findings from this mode turn into code changes, the same pass must touch the docs that describe them. If you only produce the report (no fixes in this session), skip this phase — but flag it for whoever applies the fixes.

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

### Preferred Remedies

- Delete a whole layer of indirection rather than polishing it.
- Reframe the state model so conditionals disappear instead of getting centralized.
- Change the ownership boundary so a feature becomes a natural extension of an existing abstraction.
- Turn special-case logic into a simpler default flow with fewer exceptions.
- Split a large file into smaller focused modules; extract helpers or pure functions.
- Replace condition chains with a typed model or explicit dispatcher; make type boundaries explicit so control flow gets simpler.
- Separate orchestration from business logic; collapse duplicate branches into one clearer flow.
- Delete wrappers that do not meaningfully clarify the API; reuse the existing canonical helper instead of a near-duplicate.
- Move logic to the package/module/layer that already owns the concept.
- Parallelize independent work when that also simplifies the orchestration; restructure related updates into a more atomic flow.
- Upgrade dependencies to the current major and adopt the modern API; replace a redundant dependency with the one already in the project, or with the platform built-in.

Do not be satisfied with "maybe rename this" feedback when the real issue is structural.

### Review Tone

Direct, serious, demanding about quality. Not rude, but do not soften major issues into mild suggestions. If the codebase is messier than its features warrant, say so clearly. If a path to a dramatic simplification was missed, say that too.

### Approval Bar

A codebase passes this mode when:

- No file exceeds 1000 lines without an explicit justification.
- No obvious code-judo move is sitting on the table.
- No spaghetti special-casing in shared flows; no thin wrappers or identity abstractions.
- No casts / `any` / `unknown` papering over an unclear invariant; no architecture-boundary leaks or duplicated canonical helpers.
- No CONFIRMED correctness, incoherence, or affordance finding left unaddressed or unacknowledged.
- All direct dependencies are within one major of current, used in their maintainer-recommended modern form, with no two duplicating roles.

If any of those fail, the report must include explicit, actionable feedback and push for the cleaner shape.

### Attribution

Structure lens ported from [`cursor/plugins/cursor-team-kit/skills/thermo-nuclear-code-quality-review`](https://github.com/cursor/plugins/tree/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review) (whole-codebase scope and the context7 dependency audit are cc-settings additions). Behavior lens adapted from the fable audit goal-spec trio (gist `diegomarino/04970a2b8d9cc419de3ba05b9a03db5a`).

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

## Mode: Performance

Whole-repo performance audit with one governing rule: **a finding does not exist until a number confirms it.** Rides the Shared Contract's report shape, with the evidence rule below overriding its CONFIRMED/PLAUSIBLE split — this mode has no PLAUSIBLE tier.

**Role.** A performance engineer who does not believe anything until it's measured; a user on a mid-range phone on 4G; a CI bot billing by the build-minute.

### Evidence rule (the mode's spine)

- **Empirical only.** Source reading generates *hypotheses*, never findings. A hypothesis becomes a finding only when a measurement confirms it — a profile, a benchmark, a timed curl, analyzer output, a Lighthouse run.
- **Every finding ships its number and the command that produced it**, so any reader can re-run it. The collected commands double as the regression harness for whoever applies fixes.
- **Unmeasurable hypotheses** (the surface can't be exercised, the tool isn't available) go to an explicit **Unmeasured candidates** appendix: ungraded, uncounted, absent from the summary table. They are leads for a future audit, not findings.
- **Nothing runnable at all** (can't build, can't serve, no bench entry points)? Stop. Report "not measurable" with the list of what would need to exist to measure — never degrade into a speculative report.
- **No invented numbers, no estimated savings.** A fix's benefit is measured after it lands by re-running the logged command — never predicted in the report (AGENTS.md "no savings against a run that never happened").

**Measurement hygiene:** ≥3 runs per number, report median + spread; production builds only (`next dev` skips optimization paths and lies); label cold vs warm; same machine for any two numbers you compare; record the exact command next to every number.

### Phase 0 — What's runnable

Detect the repo's shape and build the measurement plan before measuring anything:

- **Web app** — can you `next build && next start` (or the framework's equivalent)? Which routes matter most (traffic order if analytics are known, else: home, top nav destinations, heaviest template)?
- **Server/API** — can you start it locally and hit endpoints? Is there query logging to count round-trips?
- **CLI/library** — what are the entry points worth timing? (Startup, the hot command, the public API's hot function.)
- **The build itself** — always measurable: full build wall-time, test-suite wall-time, CI duration from recent run logs.

The plan lists each surface, the measurement command, and the budget or leverage anchor it will be graded against. Surfaces the repo doesn't have (no client? no client-runtime section) are marked not-applicable, not skipped silently.

### Phase 1 — Baseline measurements

One pass per applicable surface; every number goes into the Measurement Log.

1. **Client runtime** — delegate to the same Lighthouse protocol `/lighthouse` uses (3 mobile + 3 desktop runs, averaged) against the production build, per key route. Collect LCP, INP (or TBT as lab proxy), CLS, plus long-task totals from the traces.
2. **Bundle & build** — the framework's build output for per-route first-load JS; a bundle analyzer pass for composition (which deps dominate); build wall-time via `hyperfine 'bun run build'` (or 3 timed runs, median, when hyperfine is absent).
3. **Server & data** — timed requests (`curl -w '%{time_starttransfer} %{time_total}'`) against the local production serve, per key endpoint; query counts per request from logs to catch N+1s; request logs or Server-Timing headers to expose waterfalls.
4. **Hot paths (code-level)** — CPU profile the heaviest flow (`node --cpu-prof` / bun's inspector / React Profiler for render counts), or micro-benchmark a suspect function with `hyperfine` or the test runner's bench support.

### Phase 2 — Hypothesis sweep (static, generates no findings)

Now read source for suspect patterns, each recorded as a hypothesis **with the measurement that would confirm it**: sequential `await`s on independent work → time the flow before/after in a scratch branch, or profile the waterfall; N+1-shaped data access → query count per request; heavyweight imports in client components → analyzer composition; missing `dynamic()` splits → per-route first-load JS; sync I/O or allocation in loops → micro-benchmark; unmemoized components in hot trees → React Profiler render counts. Cross-check against `rules/performance.md` and `rules/react-perf.md` for the patterns Darkroom already bans. When the project has `tldr`, use the call graph to target the sweep — high fan-in hubs from `tldr calls`/`tldr arch` are the hot-path candidates worth profiling first — instead of grepping blind.

### Phase 3 — Confirm or discard

Run the confirming measurement for every hypothesis:

- **Confirmed with a number** → finding, graded below.
- **Measured and fine** → Considered & Rejected, with the number (this is the valuable half — it stops the next audit re-measuring it).
- **Couldn't be measured** → Unmeasured candidates appendix.

### Severity — two anchors, both empirical

**Budgets** (for surfaces with a named limit). Budget sources in priority order: a budget file already in the repo (`lighthouserc`, `budgets.json`, perf config) → the budgets table in `rules/performance.md` (Darkroom repos) → these defaults: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1 (CWV "good"), first-load JS ≤ 150KB gzipped per route. State which source each grade used.

**Leverage** (for measured costs with no named budget): measured cost per hit × how often the path is hit. A 300ms serial waterfall on every page load outranks a 2s cold start in a weekly script.

- **HIGH** — a user-facing budget violated on a high-traffic path, or leverage in the same range (hundreds of ms × every-interaction frequency).
- **MEDIUM** — budget violated on a secondary path; internal budgets (build, CI, test wall-time) materially regressed; moderate leverage.
- **LOW** — within budget but measurably wasteful; low-frequency paths.

### Output

Shared Contract report at `docs/audits/performance-audit-YYYY-MM-DD.md`, with mode-specific mechanics: the summary-table status column reads **measured** (there is no PLAUSIBLE); every finding row carries its number, the command that produced it, and its anchor (budget source or leverage math); two extra sections — **Measurement Log** (every command run, median, spread, environment) and **Unmeasured candidates**. Findings hand off to `/lighthouse` (client-runtime fixes with a target to loop against) or `/refactor` (structural fixes); this mode never applies fixes itself.

**Boundary:** animation frame-rate and jank findings belong to Motion mode's performance category, not here — note them and move on.

## Mode: Threat-Model

Repo-grounded STRIDE-style threat modeling: enumerate trust boundaries, assets, attacker capabilities, and abuse paths for a repo or path, then write a standing threat-model document. Adapted from openai/skills `security-threat-model` (Apache-2.0).

**Role.** An AppSec reviewer who has actually read this codebase — every architectural claim is anchored to code you can cite, and every assumption is stated rather than silently guessed.

**Scope.** The target repo or path. Extract components, data stores, and entry points; separate what actually runs in production from build/test tooling. Note the deployment model, internet exposure, and auth expectations where the repo makes them explicit — everything else is an assumption to confirm below.

**Hunt for:**
1. **Trust boundaries and assets** — every point where data crosses from lower to higher trust (network → app, user → privileged, tenant → shared store); catalog the risk-driving assets — credentials, tokens, PII, payment data.
2. **Attacker capability calibration** — what a realistic attacker can and cannot do given the exposure and deployment model. State non-capabilities explicitly ("no physical access, no insider access") — an uncalibrated attacker inflates every finding downstream.
3. **Abuse paths** — concrete paths tied to attacker goals: exfiltration, privilege escalation, integrity compromise, denial of service. Each path names the entry point, the boundary crossed, and the asset at risk — never a generic "could be exploited."
4. **Severity** — qualitative likelihood × impact per abuse path, with the reasoning written out. No inflated severity: a theoretical path with no realistic attacker capability is Low, not High.
5. **CI and supply-chain surface** — the repo's own delivery pipeline is an entry point: `.github/workflows/` triggers, action pinning, expression interpolation, token permissions, and publicly-reachable framework endpoints (Next.js Server Actions). Walk the checklists in `docs/security-reference.md` → "Framework Auth & Supply-Chain Checklists" (adapted from vercel-labs/deepsec, Apache-2.0).

**Map section:** a trust-boundary diagram (Mermaid flowchart — same preference as Docs mode) plus the asset inventory.

**Method addition:** before finalizing, pause and ask the user anything load-bearing the repo alone can't answer — deployment model, scale, auth scheme, internet exposure, data sensitivity, multi-tenancy. Those answers reshape severity, so resolve them before writing mitigations, not after.

**Extra output:** mitigations mapped one-to-one to the components/boundaries they protect, never a generic hardening checklist; and a QA pass confirming every entry point, boundary, and assumption is accounted for before delivery. Uses the same `docs/audits/threat-model-audit-YYYY-MM-DD.md` output path and stable-ID contract as the other Shared Contract modes.

## Mode: SEO

Repo-grounded discoverability audit for search engines and answer engines (AEO — being findable and citable by LLM crawlers). Distilled from shipped Darkroom work: satus PRs #348/#405/#413 and darkroomengineering/website PRs #40/#65 converged independently on one architecture, and this mode encodes that destination shape as checks. Rides the Shared Contract above.

**Role additions:** a search crawler that executes no JavaScript; an answer engine assembling a citation from a single fetch; a CMS editor who expects everything they publish to be reachable.

**Scope.** The full discoverability surface: metadata generation (canonicals, OG, descriptions), sitemap/robots/llms.txt generation, structured-data builders, the route layer that must render every content type those surfaces enumerate — and, whenever a build or deploy is reachable, the rendered output itself. Prefer curling a `next build && next start` (or a preview deploy) over source reading alone; `next dev` skips static-generation paths that change metadata output.

**Hunt for:** run every check in `references/seo-checks.md` (S1–S17, stable IDs — cite them in findings), grouped:

1. **Canonical integrity** (S1–S3) — self-referential per route, never inherited from a layout; child canonicals that don't wholesale-drop shared alternates (Next replaces, never merges, a child's `alternates`); canonical and sitemap generated from one route-enumeration source.
2. **Advertised vs rendered** (S4–S5) — every sitemap URL returns 200 (the sitemap never checks reachability itself; the highest-value mechanical check in the mode); demo/example/admin routes carry their own route-level noindex, independent of sitemap exclusion.
3. **Per-content metadata** (S6–S9) — unique title/description/OG image per content item; `og:type`/`@type` matched to what the content is (editorial = Article, case study = CreativeWork); exactly one base-URL source with no inline env reads; empty CMS descriptions falling back to body-derived text, never the site-wide default.
4. **Structured data** (S10–S13) — CollectionPage + ItemList on listing pages; JSON-LD via script tag with `<` escaped (microdata is valid per Google — in client-rendered trees it's a migration suggestion, not a defect); no null/undefined/empty-array values (absent beats present-but-broken); no fabricated entity facts — an invented date passes validation and is never caught.
5. **AEO surfaces** (S14–S17) — `/llms.txt` generated from the same facts object and route enumeration as everything else; AI search/citation crawlers named explicitly in robots.txt (several only honor directives addressed by name; training-consent tokens are an owner decision, not a defect); a plain-HTML machine-view route for canvas/WebGL-heavy sites; parity between any hand-maintained page list and the sitemap.

**Map section:** the discoverability data-flow — which module enumerates routes, which consumers read it (sitemap, llms.txt, canonicals, machine view), and every place two surfaces derive the same fact independently. Each independent derivation is a standing drift risk even while currently in agreement.

**Method addition:** run the mechanical checks first — they are cheap, and their findings are CONFIRMED by a curl. Read source second, to locate fixes and to catch the architectural absences the curls can't see (no shared route module, no schema builder at all). A check that needs a running site when none is reachable downgrades to PLAUSIBLE from source reading — say so per finding.

**Extra output:** a per-check verdict table (S1–S17: pass / finding ID / not-applicable) so the next audit starts from deltas; fix recommendations point at the destination shapes in `references/seo-checks.md` rather than restating them.

---

## Mode: Motion

Survey a codebase's animation and motion code as a senior motion advisor, then
produce a prioritized audit and self-contained implementation plans for other agents
(or cheaper models) to execute. Adapted from emilkowalski/skills `improve-animations`
(MIT). Read-only on source — like every mode in this skill, it plans, it does not
apply fixes. Unlike the Shared Contract modes, its output is a vetted findings table
followed by plan files, closer in spirit to `improve-animations`' own
audit-then-plan workflow.

**Role.** A senior design engineer with a brutal eye for craft, hunting the animation
work with the highest leverage — the `ease-in` that makes every dropdown feel
sluggish, the keyframes that make toasts jump, the keyboard action that should never
have animated. The bar and the exact values (easing curves, duration budgets, spring
configs) live in `rules/ui-skills.md` "Animation Constraints" and
`rules/motion-physics.md` — pull values from there, never approximate.

**Phase 1 — Recon.** Stack, motion libraries (GSAP, Motion/Framer Motion, Lenis,
plain CSS, WAAPI), where motion lives (tokens, Tailwind config, keyframes,
`transition`/`animate` props, gesture handlers), existing easing/duration
conventions, product personality (playful consumer app vs crisp dashboard), and a
frequency map (which animated elements are hit 100+/day vs occasionally vs rarely —
this drives severity). Useful sweeps: grep for `transition`, `animation`,
`@keyframes`, `motion.`, `animate={`, `useSpring`, `ease-in`, `transition: all`,
`scale(0)`, `prefers-reduced-motion`, `transform-origin`.

**Phase 2 — Audit**, against eight categories: purpose & frequency; easing &
duration; physicality & origin; interruptibility; performance; accessibility;
cohesion & tokens; missed opportunities. For anything beyond a small repo, fan out
one read-only subagent per category (or per app area for large monorepos) — each
prompt must carry the recon facts, the category to audit, an instruction to return
findings only (`file:line` + evidence, no fixes), and this mode's read-only rule
verbatim.

**Phase 3 — Vet, prioritize, confirm.** Re-read every finding's cited code yourself;
reject anything by-design, mis-attributed, or exempt (e.g. `transform-origin: center`
on a modal is correct). Present as one table ordered by leverage (impact ÷ effort):
`# | Severity | Category | Location | Finding | Fix summary`. Severity: **HIGH** =
feel-breaking (wrong easing on UI, animation on a keyboard/high-frequency action,
dropped frames, `scale(0)`); **MEDIUM** = noticeably off (wrong origin,
non-interruptible dynamic UI, missing reduced-motion); **LOW** = polish (stagger,
token consolidation). List 2–4 missed opportunities (places that don't animate but
should) separately. Then stop and wait for the user to pick which findings become
plans; default to the top 3–5 by leverage if running non-interactively.

**Phase 4 — Write plans.** One plan per selected finding, into `plans/` as
`NNN-short-slug.md` (monotonic numbering, respect existing plans), stamped with
`git rev-parse --short HEAD`. Each plan is fully self-contained — the executor has
zero context from this conversation: exact file paths and current-code excerpts,
exact target values (never approximated), ordered steps, hard scope boundaries, and
a verification section including how to feel-check the result (slow motion /
frame-by-frame / real device for gestures). Update `plans/README.md` with execution
order, dependencies, and status.

**Invocation variants:**

| Invocation | Behavior |
|---|---|
| bare | Full workflow: recon → audit all 8 categories → vet → confirm → plans |
| a category focus (e.g. "audit the animation performance") | Recon + that category only |
| `plan <description>` | Skip the audit; recon just enough to specify, then write a single plan for the described improvement |

---

## Mode: Debt

Collect every deliberate shortcut in the repo into one ledger, so a deferral can't
quietly become permanent. Unlike the other seven modes this one is mechanical: it
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
