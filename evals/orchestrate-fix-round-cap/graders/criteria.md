---
type: llm
weight: 1
---

PASS if the response says all of the following:
1. Round 4 does not resume the same implementer again; it starts a fresh implementer on a stronger model (Fable, or "a stronger/more capable model"), handing it the brief, the open finding, and what the earlier rounds tried.
2. There is a hard cap: at most five fix rounds for the task (round 5 is the last).
3. If the finding is still open after round 5, the orchestrator stops working on Task B and reports it as blocked with the attempts, instead of looping further.

FAIL if the response recommends resuming the same implementer for round 4, gives no round limit, or suggests continuing to loop on fixes with no stopping point.
