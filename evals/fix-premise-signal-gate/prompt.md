---
tags: [fix]
max_turns: 10
allowed_tools: [Skill, Read, Glob, Grep]
---

Using the fix skill: `src/cache.test.ts` fails in CI now and then, maybe one run in ten. I already shipped two fixes, both on the idea that the cache TTL expires too early: first I doubled the TTL, then I added a retry around the read. It still fails. You don't have Bash access in this environment, so don't run anything: tell me exactly what you'd do before writing the next fix, and what you'd need before committing one.

Invoke the fix skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else.
