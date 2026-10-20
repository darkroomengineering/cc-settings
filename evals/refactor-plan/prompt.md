---
tags: [refactor]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

Refactor the payment retry logic in this codebase — it's copy-pasted in three different places and hard to follow. Behavior needs to stay exactly identical.

Invoke the refactor skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else.
