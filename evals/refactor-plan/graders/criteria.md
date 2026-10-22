---
type: llm
weight: 1
---

PASS if the final response asks a clarifying question about the target shape / what must not change / what "done" looks like before proposing an approach, or describes delegating to explore/planner-style analysis first, rather than immediately dumping a rewritten implementation with no exploration or clarification step.
FAIL if the response silently produces sweeping code changes with no clarifying question and no exploration/planning step first.
