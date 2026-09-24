---
type: llm
weight: 1
---

PASS if the final response passes the request through a GO/NO-GO style feasibility gate before proposing delegation: either it states an explicit GO/NO-GO/SIMPLIFY verdict, or it asks a clarifying question because it can't confirm the workstreams are independent/well-specified in this environment (e.g. no existing codebase to anchor the work to).
FAIL if the response silently jumps straight to fanning out agents or doing the work itself with no verdict and no clarifying question about scope or independence.
