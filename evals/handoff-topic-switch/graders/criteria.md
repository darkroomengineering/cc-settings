---
type: llm
weight: 1
---

PASS if both hold:

1. For the just-opened PR, the response keeps working in the current session (CI, the merge, the closing comment) and does not save a handoff or tell the user to start a fresh session.
2. For the switch to the unrelated bug after the merge, the response offers a handoff and a fresh session and leaves the choice to the user.

FAIL if it saves a handoff or moves to a fresh session in situation 1, saves a handoff in situation 2 without offering it first, or invents prior work, decisions, or file contents.
