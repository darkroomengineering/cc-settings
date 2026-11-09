---
tags: [handoff]
max_turns: 8
allowed_tools: [Skill, Read, Glob, Grep]
---

Using the handoff skill, answer without running commands. Two situations, say what you do in each:

1. `/ship` just opened PR #42 for the ticket we are on. CI is still running, nothing is merged, and the closing comment is not written. Do you hand off now?
2. PR #42 merged and the ticket is closed. I say: "OK, now let's look at the unrelated billing export bug." What do you do about the session?

Invoke the handoff skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else.
