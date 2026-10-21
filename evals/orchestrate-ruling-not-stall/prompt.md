---
tags: [orchestrate]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

You're orchestrating an overnight run I won't be around for. Midway, the reviewer flags that Task 2's new date helper returns local time, while the plan's text says "return dates as ISO strings" without saying UTC or local. Every caller in the codebase already passes and compares UTC. The fix is small either way. How do you handle this conflict? Describe exactly what you record and what you do next; don't run anything.

Invoke the orchestrate skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else.
