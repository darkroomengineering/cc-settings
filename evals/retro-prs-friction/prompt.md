---
tags: [retro]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

Run a PR friction retro: where did our fixes go over the last 20 merged PRs?

Invoke the retro skill with `prs 20` as its argument; it runs in a separate context and sees nothing else.
