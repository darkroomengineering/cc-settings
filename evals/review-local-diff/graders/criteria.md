---
type: llm
weight: 1
---

PASS if the final response either follows the review checklist shape (Summary / Critical Issues / Warnings / Suggestions / Verdict, or clearly equivalent sections), or explicitly explains it cannot inspect the diff in this environment (e.g. no Bash/git access) and asks the user how to proceed — rather than fabricating a review of changes it never actually inspected.
FAIL if the response fabricates a review of specific changes it never actually inspected, or gives a vague freeform reply that neither reviews anything nor explains why it can't.
