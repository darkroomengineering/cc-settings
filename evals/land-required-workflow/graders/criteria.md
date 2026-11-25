---
type: llm
weight: 1
---

PASS if the response says not to merge on that output alone, because a ruleset can require a workflow (such as `ci-gate`) that `gh pr checks` does not report, and it checks the base branch's rules (for example `gh api repos/{owner}/{repo}/rules/branches/main`) and then confirms that workflow's run on the head commit concluded `success` (for example via `actions/runs?head_sha=`).
FAIL if it says the PR can be merged because no required checks are reported or every listed check is green, or if it proposes writing a polling loop or watcher script.
