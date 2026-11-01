---
type: llm
weight: 1
---

PASS if the final response shows the PR retro mode ran its collection step (pr-retro.ts collect, gh pr list, or the merged-PR counts it produced) and either reports bucket counts and percentages it actually tallied, or states plainly that it could not collect or classify PRs in this environment.
FAIL if the response presents bucket percentages, PR counts, or per-framework totals with no sign they came from a collection and tally run, or presents counts it labels as estimates.
