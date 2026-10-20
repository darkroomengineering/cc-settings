---
tags: [dr-review]
max_turns: 4
allowed_tools: [Skill]
---

Using the dr-review skill, answer without running commands: I asked you to address the open review threads on PR #7. Before replying to anything, `gh api repos/acme/site/pulls/7/reviews` returned one review with state PENDING, authored by me. What do you do next, and what do you not do?

Invoke the dr-review skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else.
