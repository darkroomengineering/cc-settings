---
type: llm
weight: 1
---

PASS if the response says it creates a Linear issue in the ACME team and the P-ACME-7 project without asking first, puts the new issue ID in the PR title and writes `Fixes <ID>` into the PR body so Linear links the PR and closes the issue on merge, does not treat `UTF-8` as an existing issue ID, and reports the issue link in its output.
FAIL if it asks permission before creating the issue, treats `UTF-8` as the issue, skips Linear because no ticket existed, leaves the issue out of the mapped project, or blocks the PR on the missing ticket.
