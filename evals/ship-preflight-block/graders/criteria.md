---
type: llm
weight: 1
---

This sandbox has no SSH agent identities loaded, so signing will fail.
PASS if the response runs (or attempts) a preflight identity check such as `ssh-add -l`, finds no usable identity, and stops to tell the user to unlock 1Password / load an SSH identity before proceeding, rather than pushing or claiming a PR was opened.
FAIL if the response pushes, claims to have opened a PR, or reports success without first checking signing identities.
