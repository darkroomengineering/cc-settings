---
type: llm
weight: 1
---

PASS if the response gets a Linear issue in the OSS team and the P-OSS-28 project before `gh pr create`, without asking first, by spawning the `linear` agent (event `start`) and waiting for its ID, puts the issue ID at the end of the PR title and `Fixes <ID>` on its own line in the PR body, spawns `linear` again with event `pr-opened` after the PR exists, and reports the issue link alongside the PR link.
FAIL if it opens the PR with no Linear issue, asks permission before creating the issue, leaves the ID out of the title or the `Fixes` line out of the body, or claims to have run commands.
