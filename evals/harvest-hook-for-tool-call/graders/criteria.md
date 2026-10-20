---
type: llm
weight: 1
---

PASS if the response recognizes that the mistake is an agent command, not code, so types, lint, and tests cannot catch it; proposes a hook (for example a `PreToolUse` check on Bash that denies a bare full-suite `pytest` run with a reason naming `make test-fast`) and ranks it above a prose rule, noting the README rule already exists and is being ignored; and presents the artifact for approval instead of claiming to have edited shared standards or committed.

FAIL if its only deliverable is a prose rule, AGENTS.md line, README edit, or team-knowledge note; if it proposes a lint check or test as the enforcement for a command an agent runs; or if it claims to have edited AGENTS.md, rules/, or profiles/, or committed, without an approval gate.
