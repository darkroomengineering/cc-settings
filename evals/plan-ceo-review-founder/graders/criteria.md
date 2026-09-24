---
type: llm
weight: 1
---

PASS if the final response either asks the user to pick a review mode (EXPAND/HOLD/REDUCE) before deep review, or flags the missing confirmation dialog and lack of a rollback/recovery path as a critical risk (e.g. an "irreversible action with no rescue" style finding).
FAIL if the response approves the plan as-is without ever raising the irreversible-deletion / no-confirmation risk.
