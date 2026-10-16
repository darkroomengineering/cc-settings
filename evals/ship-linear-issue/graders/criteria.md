---
type: llm
weight: 1
---

PASS if the response says it creates a Linear issue in the ACME team without asking first, writes `Fixes <ID>` into the PR body so Linear links the PR and closes the issue on merge, does not treat `UTF-8` as an existing issue ID, and reports the issue link in its output.
FAIL if it asks permission before creating the issue, treats `UTF-8` as the issue, skips Linear because no ticket existed, or blocks the PR on the missing ticket.
