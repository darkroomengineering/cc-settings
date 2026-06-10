---
name: proof-of-work
description: Run the machine-verifiable gate (typecheck/test/lint, plus a screenshot for UI) so an agent's diff is "review-ready" before it reaches a human. Triggers "proof of work", "is this review-ready", "verify before review", "prove it is green", or after an agent finishes a diff-producing task.
---

# Proof of Work

The Amdahl-shrink move from the Orchestration Tax: human review is the serial bottleneck, so don't spend it confirming what a machine can verify. An agent's diff is **review-ready** only when the machine-verifiable battery is green — types, tests, lint (and a screenshot for UI). What a machine can prove shouldn't cost a human's attention.

## The gate

Run the battery on the current working tree:

```bash
bun run proof
```

It detects `typecheck` / `test` / `lint` from `package.json`, runs them cheapest-first, and prints one verdict:

- exit 0 → `review-ready ✓`
- exit 1 → `NOT review-ready ✗` — fix the failing gate before a human looks

Projects can opt into **advisory** probes by depending on the tool — the gate then runs the project's pinned binary: **react-doctor** (React render/quality score, telemetry off) and/or **deslop** (framework-agnostic cross-file dead-code count). Advisory results are reported but never flip the verdict — deterministic signals alongside the hard gates, not blockers. Silent for projects that don't depend on them.

For UI changes, attach a screenshot (`/qa` or the chrome-devtools MCP) as the visual half of the proof — tests can't prove "looks right".

## The contract

- A diff-producing agent (implementer, scaffolder, maestro, deslopper) **attaches a proof report before handing back**. "Done" without green proof is not done.
- The human/reviewer spends the lock on judgment — architecture, intent, edge cases — not on re-running what the gate already proved.
- Pairs with the review-queue: backpressure (`the review-queue branch of tool-cadence.ts`) limits how many *unproven* diffs pile up; this gate makes each one cheaper to close.

## When NOT to gate

Pure-research or read-only agent output (explore, oracle) has no diff to prove — proof-of-work is for changes, not findings.
