---
tags: [orchestrate]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

I need to add rate limiting, write API docs, and add a changelog entry — three independent workstreams with no file overlap. Can you fan out agents to get all three done in parallel?

Invoke the orchestrate skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else.
