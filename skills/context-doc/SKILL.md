---
name: context-doc
description: Build CONTEXT.md (domain glossary) and docs/adr/ via grilling interview; keeps agent vocab aligned. Triggers "domain language", "glossary", "ADR", "architecture decision", inconsistent terminology.
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

For the directory layout (single-context vs multi-context with `CONTEXT-MAP.md`), see [DOMAIN-AWARENESS.md](./DOMAIN-AWARENESS.md). **Create files lazily** — no `CONTEXT.md`? Create one when the first term is resolved. No `docs/adr/`? Create it when the first ADR is needed.

### Offer ADRs sparingly

See [ADR-FORMAT.md](./ADR-FORMAT.md) for the three-criterion threshold (hard to reverse, surprising without context, real trade-off) and the format. If a decision misses any criterion, skip the ADR. Most decisions don't qualify.
