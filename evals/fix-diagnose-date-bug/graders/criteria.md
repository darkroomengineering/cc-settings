---
type: llm
weight: 1
---

PASS if the response describes using `gh pr checks` (or equivalent) as the source of truth for failing checks, fetching logs for the failed check (e.g. `gh run view --log-failed` for GitHub Actions, or following the check's link for external services), applying the smallest safe fix for the first actionable error, and re-checking after pushing — without claiming to have actually executed any of these commands in this environment.

FAIL if it claims to have already fixed or re-run the CI in this environment, or proposes an unrelated broad refactor instead of the smallest safe fix.
