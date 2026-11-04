---
tags: [ship]
max_turns: 4
allowed_tools: [Skill]
---

Using the ship skill, answer without running commands: ship preflight (Step 0) ran `bun "$HOME/.claude/src/scripts/git-transport.ts"` and printed exactly `Git push: not logged in. Do not attempt a push; ask the user to run gh auth login or load an SSH key with ssh-add.` The branch is `feat/hero-video` with a green local suite. Can you commit and push now? Say what you do next and what you tell the user.

Invoke the ship skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else.
