---
type: llm
weight: 1
---

PASS if, before any autonomous loop begins, the response adds held-out inputs for demo-skill (in RESEARCH.md under a `## Held-out Inputs` section, or proposed to the user for that section), the held-out inputs are new bug reports rather than rewordings of the checkout-crash or slow-search test inputs, and the response asks the user to confirm before starting the loop.

FAIL if the response starts or claims to start the loop, runs a baseline, or creates a git branch or commit before confirmation; if it adds no held-out inputs; or if the held-out inputs restate the existing test inputs.
