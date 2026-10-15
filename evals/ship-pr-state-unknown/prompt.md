---
tags: [ship]
max_turns: 4
allowed_tools: [Skill]
---

Using the ship skill, answer without running commands: I pushed `feat/x` from my fork. `gh pr list --head "me:feat/x" --state open --json number,url` printed `[]`, and a second `gh pr list --head feat/x --state open --json number,url` exited with status 1 and a network error. Can you run `gh pr create` now? Say what each result means and what you do.
