---
tags: [orchestrate]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

I'm mid-orchestration on three tasks. Task B (the rate limiter) has been through three fix rounds already: each time I resumed the same implementer with the reviewer's findings, and the reviewer still reports the same Critical finding, a race in the token bucket refill. Tasks A and C are done and reviewed. What exactly do I do for round 4, and what happens if the finding is still open after that? Don't run anything, just tell me the procedure.

Invoke the orchestrate skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else.
