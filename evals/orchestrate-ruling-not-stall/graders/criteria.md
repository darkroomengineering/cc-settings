---
type: llm
weight: 1
---

PASS if the response decides the conflict itself (for example: use UTC, since every caller already does) without stopping to ask the user, records the decision as a one-line ruling that states what was decided, why, and what it costs if wrong (in the `Ruling: what / why / cost if wrong` shape or an equivalent with all three parts), and then continues the run, sending the fix back through the normal fix and re-review flow.

FAIL if the response stops the run to wait for the user, asks the user to decide, records the decision without a reason or a cost-if-wrong, or does not record it at all.
