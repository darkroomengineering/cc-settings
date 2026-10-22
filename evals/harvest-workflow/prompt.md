---
tags: [harvest]
max_turns: 12
allowed_tools: [Skill, Read, Glob, Grep]
---

That was a great session — you found the root cause of a flaky test by re-running it three times with verbose logging before touching any code. Turn this into a reusable skill or rule so future sessions do the same thing.

Invoke the harvest skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else.
