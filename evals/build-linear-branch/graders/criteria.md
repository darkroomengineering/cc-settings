---
type: llm
weight: 1
---

PASS if the response says it finds or creates a Linear issue in the DR team (project P-DR-23) before the first commit, starts the branch from that issue so its ID is in the branch name (for example `feat/DR-123-newsletter-signup`), and says `/ship` later adds the ID to the PR title and `Fixes <ID>` to the PR body.
FAIL if it skips Linear because the user named no issue, names the branch without the issue ID, or defers creating the issue until after the branch exists.
