---
name: plan-feature
description: Pre-implementation planning — interview to clarify scope, then compile into a PRD. Triggers "help me figure out", "vague scope", "define requirements" (discovery phase); "PRD", "requirements document", "product spec", "feature spec", "write requirements" (PRD phase).
context: fork
agent: planner
---

# Plan Feature

Two-phase pre-implementation planning: clarify requirements via interview, then compile a complete PRD.

## Phase 1: Discovery

Help clarify requirements and scope through structured questioning.

### Interview Framework

The interview is a fog-of-war walk across four quadrants of the unknown. Open by listing the **known knowns** (what the user has already decided), then work the questions below to surface **known unknowns** (open questions they're aware of), **unknown knowns** (constraints they hold but haven't said — the questions in 2–4 exist to shake these loose), and close by hunting **unknown unknowns** ("what would surprise us mid-build? what reference implementation should we read first?"). A discovery that ends with all four quadrants visited produces a PRD that doesn't get re-planned in week two.

### Goal Quality Bar (gate before interviewing)

Before opening the interview questions below, try to state the goal in one line that answers five things:

- What's true when this is done?
- What evidence shows it — a command, a test, a metric, a reviewed artifact?
- What threshold counts as success — pass/fail, or a number?
- What's explicitly out of scope, where that would matter?
- What's the stop condition — the point where you ask the user instead of guessing?

If a clean one-liner falls out, skip straight to Phase 2's clarifying questions — the interview below exists for when it doesn't.

Reject pure activity goals — "make progress," "keep investigating," "improve things" — until sharpened into a verifiable outcome:

- Weak: "Make checkout faster." Sharpened: "Reduce checkout API p95 latency below 250ms for the documented slow path, verified with `npm run test:checkout` and 3 consecutive benchmark runs under 250ms."
- Weak: "Clean up the auth code." Sharpened: "Resolve the open change-request threads on PR 123, touching only the affected auth files and tests, verified with the targeted auth test command plus `gh pr view 123` showing no unresolved threads."

Pick the validator shape by domain:

| Domain | Success looks like |
|---|---|
| Bug | Reproduce first, fix second — a failing-then-passing test or repro script |
| Test | The exact command and its pass condition |
| Performance | Metric + threshold + measurement method + run count |
| Quality | Reviewed examples, or lint/typecheck/test passing |
| Research | The decision the research needs to unblock |
| Ops | Healthy state + monitoring window + rollback trigger |

*Goal Quality Bar adapted from openai/skills `define-goal`, Apache-2.0.*

#### 1. Understand the Goal
- What problem are you solving?
- Who is this for?
- What does success look like?

#### 2. Define Scope
- What must be included (MVP)?
- What's nice to have (future)?
- What's explicitly out of scope?

#### 3. Identify Constraints
- Timeline constraints?
- Technical constraints?
- Resource constraints?

#### 4. Clarify Details
- What are the inputs/outputs?
- What are the edge cases?
- What are the error scenarios?

#### 5. Validate Understanding
- Summarize back what you heard
- Confirm priorities
- Identify open questions

### Output

```
## Discovery Summary: [Feature/Project]

### Goal
[Clear statement of what we're building and why]

### Requirements
**Must Have (MVP)**
- [ ] Requirement 1
- [ ] Requirement 2

**Nice to Have**
- [ ] Feature A
- [ ] Feature B

**Out of Scope**
- Not doing X
- Not doing Y

### Technical Approach
[High-level approach]

### Open Questions
- [ ] Need to clarify: ...
- [ ] Decision needed: ...

### Next Steps
1. [First action]
2. [Second action]
```

### Remember

- Ask, don't assume
- Summarize frequently
- Document decisions
- Store requirements as learnings

---

## Phase 2: PRD Compilation

Structured 6-phase process to produce a complete PRD from a feature idea, including user stories, task breakdown, and parallel execution plan.

### Workflow

#### Phase 1: Clarifying Questions

Ask 5-8 targeted questions to fill gaps. Use smart defaults so the user can skip.

```markdown
## Clarifying Questions

1. **Target users?** [default: existing app users]
2. **Platform scope?** [default: web only]
3. **Auth required?** [default: yes, existing auth]
4. **Performance targets?** [default: <2.5s LCP, <200ms INP]
5. **Accessibility level?** [default: WCAG 2.1 AA]
6. **Data persistence?** [default: existing database]
7. **Mobile responsive?** [default: yes]
8. **Analytics needed?** [default: basic events]

Press enter to accept all defaults, or answer specific questions.
```

#### Phase 2: Scope Definition

Define what is IN and OUT of scope.

```markdown
## Scope

### In Scope
- [feature 1]
- [feature 2]

### Out of Scope
- [explicitly excluded 1]
- [explicitly excluded 2]

### Assumptions
- [assumption 1]
- [assumption 2]
```

#### Phase 3: User Stories

Write user stories with acceptance criteria.

```markdown
## User Stories

### US-1: [Title]
**As a** [role]
**I want** [capability]
**So that** [benefit]

**Acceptance Criteria:**
- [ ] Given [context], when [action], then [result]
- [ ] Given [context], when [action], then [result]

**Priority:** P1 | P2 | P3
**Complexity:** trivial | small | medium | large | epic
```

#### Phase 4: Task Breakdown

Break into implementable tasks with metadata. `Dependencies`/`Blocks` feed the batch
algorithm and must match the Functional DAG's joins from Phase 5 — on conflict the DAG
wins, so reconcile the metadata to it rather than redrawing to match a stale field.

```markdown
## Tasks

### T-1: [Title]
- **Description:** [what to implement]
- **User Story:** US-1
- **Priority:** 1 (1=highest, 5=lowest)
- **Complexity:** medium
- **Estimated Tokens:** 15000
- **Dependencies:** none
- **Blocks:** T-2, T-3
- **Verification:** [how to verify completion]

### T-2: [Title]
- **Dependencies:** T-1
- ...
```

#### Phase 5: Parallel Batch Detection

Draw the Functional DAG first (`docs/functional-dag.md`) — inputs left, operations merging
rightward, one terminal verification node — then read the batches off its columns. Same
column with disjoint inputs = same batch. The DAG is the source; the batch list below is
its rendering, not a second dependency graph to keep in sync.

```markdown
## Functional DAG

[recipe-table brace diagram in a fenced code block — see docs/functional-dag.md]

## Execution Plan

### Batch 1 (parallel) — estimated: 25k tokens
- T-1: Setup data models
- T-4: Create UI scaffolding
- T-7: Write test fixtures

### Batch 2 (parallel, depends on Batch 1) — estimated: 40k tokens
- T-2: Implement API endpoints (depends: T-1)
- T-5: Build form components (depends: T-4)

### Batch 3 (sequential) — estimated: 20k tokens
- T-3: Integration wiring (depends: T-2, T-5)

### Batch 4 (parallel) — estimated: 15k tokens
- T-6: E2E tests (depends: T-3)
- T-8: Documentation (depends: T-3)

### Batch 5 (terminal gate) — estimated: 5k tokens
- T-9: typecheck + full test run (depends: T-6, T-8) — the DAG's single terminal node

Total estimated tokens: 105k
Estimated context windows: 2
```

Every plan ends on the terminal gate, so the last batch is always one verification task
depending on all preceding work — never a fan-out of unverified parallel tasks.

#### Phase 6: Final PRD

Compile everything into the final document.

```markdown
# PRD: [Feature Name]

## Functional DAG
[from Phase 5 — inputs left, operations merging rightward, one terminal node]

## Overview
[1-2 paragraph summary]

## Goals
- [measurable goal 1]
- [measurable goal 2]

## Scope
[from Phase 2]

## User Stories
[from Phase 3]

## Technical Design
### Architecture
[high-level approach]

### Data Model
[key entities and relationships]

### API Surface
[endpoints or interfaces]

## Task Breakdown
[from Phase 4]

## Execution Plan
[from Phase 5]

## Success Metrics
- [metric 1: target value]
- [metric 2: target value]

## Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| [risk] | Low/Med/High | Low/Med/High | [approach] |

## Timeline
- Phase 1: [dates] — [deliverable]
- Phase 2: [dates] — [deliverable]
```

### Smart Defaults

When the user provides minimal input, apply these defaults:
- **Platform:** Web — detect from `package.json` (`next` → Next.js / satus, `react-router` → RR / novus)
- **Auth:** Existing auth system
- **Performance:** LCP <2.5s, INP <200ms, CLS <0.1
- **Accessibility:** WCAG 2.1 AA
- **Testing:** Unit + integration, no E2E unless requested
- **Styling:** Project's existing system (Tailwind if detected)

### Task Sizing Reference

See `docs/enhanced-todos.md` for the complexity/token sizing reference table.

---

## Phase 3: Close (plan → durable record)

A PRD is a **build plan** while building and a **rationale record** once shipped — closing flips it from one to the other. When the feature lands (merged, gates green), rewrite the PRD instead of letting it rot as a stale plan:

- Keep the **why**: the problem, the principles, the invariants that must never break, the approaches tried and rejected.
- Cut every paragraph that restates what the code does — point at the code instead; it is the source of truth for *how*.
- Record every **divergence from the plan** (dropped tasks, renamed seams, assumptions that broke). Divergences are the most valuable content: they're exactly what a future reader would otherwise re-derive the hard way.
- Archive it where the project keeps finished plans (e.g. `docs/prd/done/`), and promote anything decision-shaped into an ADR via `/context-doc`.

If the plan lives as GitHub issues (`/project`), the close pass is the closing comment on the epic: what shipped, what diverged, and why.
