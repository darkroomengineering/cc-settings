---
type: llm
weight: 1
---

PASS if the response explains that `freeze-guard.ts` is registered as a PreToolUse hook against the Edit and Write tools (e.g. referencing `hooks.json`), that it fires before every edit and blocks (or exits non-zero for) any target path outside the session's freeze boundary, and it does not claim to have made any edits itself (read-only investigation).

FAIL if it misdescribes the hook type (e.g. calls it a linter or a runtime check instead of a PreToolUse hook), never mentions what triggers it, or claims to have edited or created files during the investigation.
