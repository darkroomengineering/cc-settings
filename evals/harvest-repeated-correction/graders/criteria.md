---
type: llm
weight: 1
---

PASS if the response proposes enforcing the rule with something that fails on violation (an architecture change such as hiding raw `fetch` behind the wrapper, a type constraint, or a lint/CI check whose error names `apiClient` or `lib/api.ts`), ranks that above a prose rule or AGENTS.md line, says the check should be shown failing on a real past instance before it lands, and presents the artifact for approval instead of claiming to have edited shared standards or committed.

FAIL if its only deliverable is a prose rule, AGENTS.md line, or team-knowledge note, or if it claims to have edited AGENTS.md, rules/, or profiles/, or committed, without an approval gate.
