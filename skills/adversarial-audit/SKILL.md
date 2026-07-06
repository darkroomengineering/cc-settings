---
name: adversarial-audit
description: Adversarial whole-repo audits in three goal-spec modes — hunt defects, drift, and dead ends rather than validate. Triggers "adversarial audit", "fable audit", "audit the codebase", "expectation gaps" (codebase mode - correctness, incoherences, affordance mismatches); "audit the docs", "docs audit", "documentation audit", "doc drift" (docs mode - accuracy vs code, inverted pyramid, doc sizing, diagram backlog); "process audit", "audit the workflows", "walk the journeys", "end-to-end audit" (process mode - empirical journey walking, state-machine map, dead ends, re-run semantics). Sibling to /nuclear-review (maintainability + code-judo deletion) - this skill audits whether the system does what it promises, not whether it should exist.
context: main
---

# Adversarial Audit

Three audit modes sharing one skeleton: read the surface **in full** (never sample), hunt with explicit categories, try to **disprove every finding before reporting it**, and ship a top-heavy report with stable finding IDs that a fixing agent can cite one-by-one.

Adapted from the fable audit goal-spec trio (gist `diegomarino/04970a2b8d9cc419de3ba05b9a03db5a`). The July 2026 cc-settings audit ran on the codebase spec and produced 28 findings — ~all confirmed and fixed. The mechanics that made that work (stable IDs, CONFIRMED/PLAUSIBLE, concrete failure scenarios, design tensions vs line findings, open questions for the maintainer) are the contract here, whatever the mode.

## When to use vs other review skills

- `/review` — per-diff Darkroom checklist. Every change.
- `/nuclear-review` — whole-codebase **maintainability**: should this code exist, what can be deleted, code-judo restructuring.
- `/adversarial-audit` — whole-repo **honesty**: does the system do what it promises? Correctness, coherence, affordances (codebase); truth and structure of the docs (docs); walkable end-to-end journeys (process).
- `/verify` — adversarial check of a single change/claim, not a repo sweep.

Run codebase mode on the same cadence as nuclear-review (version cuts, post-sprint, pre-migration) — they compose well back-to-back since they hunt different game. Docs and process modes shine before releases and after feature bursts.

> **Tip (Claude Code v2.1.154+)**: `/effort ultracode` before invoking. Whole-repo audits are the canonical dynamic-workflow shape — fan out per-area readers, verify findings adversarially in parallel, synthesize once.

## Shared contract (all modes)

**Role.** No loyalty to the current design/structure/flows. Act simultaneously as a senior staff engineer, a skeptical first-time consumer, and an adversarial reviewer. Understand deeply enough to challenge, not merely validate.

**Method.**
- Per area, state how it SHOULD behave, then read (or run) to confirm or refute. Every expectation-vs-reality gap is a finding.
- Every finding needs a concrete scenario: specific inputs/state leading to the wrong or surprising result. No vague "could be improved."
- Mark each finding **CONFIRMED** (traced or reproduced) or **PLAUSIBLE** (suspected). Try to disprove yourself first; discard findings that don't survive.
- Where something is sound, say so once and move on — spend effort where it isn't.

**Cross-model + intent passes (gated, fail open — same pattern as nuclear-review Phases 2b/2c).** If the Codex bridge is available, run the finding list past `codex-verifier` as a second model family; convergent flags are high-conviction. If the team-knowledge corpus is reachable, reconcile findings AFTER they exist (never feed the corpus in first): a documented decision **reclassifies severity, never deletes a finding**. Unavailable? Proceed Claude-only.

**Output.** Write the full report to `docs/audits/[mode]-audit-YYYY-MM-DD.md` (create the dir; leave uncommitted — the maintainer owns git). Structure top-heavy:
1. Summary table: ID | severity | area | one-line issue | file:line | CONFIRMED/PLAUSIBLE.
2. Map (system map / doc map / process state machine — per mode below).
3. Findings by hunt category, severity order. Each: stable ID (H1/M1/L1 by severity, or C/D/P prefix per mode), location, one-line issue, concrete scenario, status, recommended direction.
4. Design tensions: the 3-5 deepest structural issues ("the approach, not a line"), each with the alternative you'd weigh.
5. Open questions: what the artifact alone can't resolve — maintainer answers required.

Chat reply = exec summary only: counts by severity + top 3-5 findings + report path.

**Optional issue filing.** When the maintainer wants findings executable by agents, file each as a GitHub issue (one per finding, severity labels, CONFIRMED/PLAUSIBLE in the body, an epic for the design tensions, `question`-labeled issues for the open questions). This is how the July 2026 cc-settings remediation ran: issues → parallel fix agents → PRs citing the IDs.

---

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
