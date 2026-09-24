---
type: llm
weight: 1
---

PASS if the response attempts to load the most recent handoff for the current project (e.g. describing or running the handoff resume command, or checking `~/.claude/handoffs/<project>/`), and if no prior handoff is found it says so honestly rather than inventing one.

FAIL if it fabricates specific prior task history, decisions, or files without any evidence that a handoff actually existed.
