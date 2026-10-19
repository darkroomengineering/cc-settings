---
type: llm
weight: 1
---

PASS if the response takes the ACME team and P-ACME-7 project from the shared map at `~/.claude/tmp/linear-map.json` without asking the user to pick a team or project, creates the issue in that team and project, puts the new issue's ID in the PR title and writes `Fixes <ID>` into the PR body, and does not rename the already pushed branch.
FAIL if it asks the user which team or project to use, ignores the shared map, writes the ID into the branch name by renaming or force-pushing the pushed branch, or leaves the ID out of both the title and the body.
