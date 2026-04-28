---
name: context-doc
description: |
  Use when:
  - User says "domain language", "context doc", "shared vocabulary", "glossary"
  - User says "ADR", "architecture decision record", "record this decision"
  - User uses inconsistent terminology and wants to lock it down
  - Starting a project where the domain has specialized vocabulary
  - User wants to challenge a plan against existing project language
  - Agent output uses generic terms instead of project-specific ones

  Builds and maintains `CONTEXT.md` (domain language glossary) and
  `docs/adr/` (architecture decision records) at the repo root via a
  grilling interview. Other skills (`/explore`, `/zoom-out`, `/tdd`)
  read these artifacts so agent output stays aligned with project
  vocabulary across sessions.
---

# Context doc — domain language + ADRs

Two persistent artifacts that stop agent drift across sessions:

- **`CONTEXT.md`** — the project's glossary. The terms domain experts and engineers both use. Updated inline as decisions crystallize.
- **`docs/adr/`** — architecture decision records. One paragraph per hard-to-reverse trade-off.

This skill produces both. Other skills read them via `DOMAIN-AWARENESS.md` (consumer rules in the same directory).

## Workflow

Interview the user relentlessly about every aspect of the plan, terminology, or area in question until you reach shared understanding. Walk down each branch of the design tree, resolving dependencies one at a time. For each question, propose a recommended answer.

**One question at a time.** Wait for feedback before continuing.

If a question can be answered by reading code, read the code instead. Don't ask the user what `git blame` will tell you.

### During the session

**Challenge against the glossary.** When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out: "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

**Sharpen fuzzy language.** When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

**Discuss concrete scenarios.** When domain relationships are being discussed, stress-test them with specific scenarios. Invent edge cases that force the user to be precise about boundaries between concepts.

**Cross-reference with code.** When the user states how something works, check whether the code agrees. Surface contradictions: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is it?"

**Update `CONTEXT.md` inline.** When a term is resolved, update the file right there. Don't batch. Format: see [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

**Don't couple `CONTEXT.md` to implementation.** Only include terms meaningful to domain experts. "Timeout" is generic; "ShipmentDispatched" is domain.

### File structure

Most repos have a single context:

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

If the repo has multiple contexts (microservices, separate domains within a monorepo), use a `CONTEXT-MAP.md` at the root that points at one `CONTEXT.md` per context:

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

**Create files lazily.** No `CONTEXT.md`? Create one when the first term is resolved. No `docs/adr/`? Create it when the first ADR is needed.

### Offer ADRs sparingly

Only offer to create an ADR when **all three** are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will look at the code and wonder "why on earth did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Most decisions don't qualify. See [ADR-FORMAT.md](./ADR-FORMAT.md).

## Why this works

Generic project rules (in `AGENTS.md`, in `rules/`) cover engineering practice. They don't know your domain. After a long conversation about Orders, Invoices, Fulfillment, and Customers, the agent forgets the specifics next session.

`CONTEXT.md` is the project-specific layer that survives. Each session re-reads it via `DOMAIN-AWARENESS.md`. The agent uses your terms in test names, file names, function names, error messages — and stops drifting toward the generic vocabulary in its training data.

ADRs do the same thing for decisions: they stop the next engineer (or the next agent) from "fixing" something that was deliberate.
