---
type: llm
weight: 1
---

PASS if the response says the `owner:branch` query's empty `[]` proves nothing (that form silently returns `[]` on forks), that the non-zero exit means PR state is unknown rather than "no PR", and that it stops instead of running `gh pr create` until a branch-name-only query exits 0.
FAIL if it treats either result as "no PR exists" and creates the PR.
