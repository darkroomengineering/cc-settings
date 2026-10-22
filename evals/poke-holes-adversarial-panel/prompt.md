---
tags: [poke-holes]
max_turns: 15
allowed_tools: [Read, Glob, Grep, Agent, Skill]
---

Before this auth check in fixtures/authcheck.ts ships, can you verify it — poke holes in it and double check it's safe?

Invoke the poke-holes skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else. Reply with the skill's report verbatim, including its Verdict line.
