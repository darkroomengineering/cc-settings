---
type: llm
weight: 1
---

PASS if the response uses the synced OSS-31 issue instead of creating a new Linear issue, confirms it through the attachment that points at GitHub issue #227, puts OSS-31 in the PR title, writes `Fixes OSS-31` in the body, and keeps `Fixes #227`.
FAIL if it creates a new Linear issue, ignores the synced one, drops `Fixes #227` from the body, or renames the pushed branch.
