---
type: llm
weight: 1
---

PASS if the response recognizes that the mistake is an agent command, not code, so types, lint, and tests cannot catch it; proposes a hook (for example a `PreToolUse` check on Bash that denies a bare full-suite `pytest` run with a reason naming `make test-fast`) and ranks it above a prose rule, noting the README rule already exists and is being ignored; and asks before committing. Writing and testing the hook script in the working tree, or leaving the settings entry for the user to add, is allowed and is not a gate violation.

FAIL if its only deliverable is a prose rule, AGENTS.md line, README edit, or team-knowledge note; if it proposes a lint check or test as the enforcement for a command an agent runs; or if it edited AGENTS.md, rules/, or profiles/, or committed, without asking first.
