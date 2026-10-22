---
type: llm
weight: 1
---

PASS if the response identifies this mechanical rename as work suited for the Codex bridge (`codex-run.ts exec`), and either (a) frames the delegated task as an outcome ("done" means every call site updated) rather than a literal step-by-step recipe and does not claim the rename is already done, or (b) actually attempts to invoke the bridge, finds it unavailable in this sandbox (not installed, no bridge script, etc.), and — per the skill's fail-open contract for reversible in-scope work — proceeds to do the rename itself directly with real tool calls instead of stopping to ask the user for permission first.

FAIL if the response silently does the rename itself without ever mentioning Codex, or asks the user for permission/confirmation before doing the rename itself after the bridge turns out to be unavailable (the skill says not to add "ask before X" language for reversible in-scope work once the bridge has failed open), or claims the rename was already completed/run via Codex with no tool evidence for it.
