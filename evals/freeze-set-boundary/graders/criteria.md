---
type: llm
weight: 1
---

PASS if the response names the command it would run to set the freeze boundary (referencing `freeze.ts set` with the `src/` path), explains that Edit and Write outside `src/` will be blocked for the session, and mentions it can be lifted later (e.g. by saying "unfreeze").

FAIL if it claims the freeze is already active without running anything, names a directory other than the one requested, or never states the actual command.
