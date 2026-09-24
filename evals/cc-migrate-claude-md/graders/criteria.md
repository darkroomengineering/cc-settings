---
type: llm
weight: 1
---

PASS if the response classifies this as a rename case (a CLAUDE.md exists with no AGENTS.md, so the whole file moves) and presents the plan — target file, what will move — while stopping to wait for approval rather than claiming the file was already renamed, committed, or deleted.

FAIL if the response claims to have already run `git mv`, committed the migration, or deleted CLAUDE.md without ever presenting a plan and waiting for confirmation.
