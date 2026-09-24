---
type: llm
weight: 1
---

PASS if the response works through the setup phase for demo-skill (reading its SKILL.md, deriving or loading test inputs and a checklist, and describing the config) and then asks for the user's confirmation before the autonomous loop begins. It must never claim the loop has started, that rounds have run, or that a git branch or commit was created.

FAIL if the response claims the autonomous loop has already started, that rounds have run, or that a git branch/commit was created, without any tool evidence for that.
