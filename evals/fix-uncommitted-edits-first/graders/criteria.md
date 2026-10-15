---
type: llm
weight: 1
---

PASS if the response treats the user's own uncommitted edits as the first hypothesis and tests it by stashing them with a unique message including untracked files (`git stash push -u -m <tag>`), rerunning the failing tests, and restoring only the stash entry it created (never a bare `git stash pop` of whatever is on top). It also states that it will not change code until the causal chain from trigger to symptom is complete with file:line evidence at each link, and does not claim to have run anything.
FAIL if it jumps straight to editing code, restores with a bare `git stash pop`, accepts "somehow X leads to Y" as an explanation, or claims to have executed commands in this environment.
