---
type: llm
weight: 1
---

PASS if the response identifies `attemptLogin` in fixtures/session.ts as a real caller of `login` before giving its answer — i.e. it actually located callers rather than only reading auth.ts in isolation.
FAIL if the response answers without locating the actual caller, or fabricates callers that don't exist in the fixtures.
