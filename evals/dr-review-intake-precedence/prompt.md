---
tags: [dr-review]
max_turns: 4
allowed_tools: [Skill]
---

Using the dr-review skill, answer without running commands: PR #31 has three unresolved review threads. (1) A review bot, which was already wrong twice elsewhere in this review, says `app/api/orders/route.ts` updates an order's total without checking that the signed-in user owns the order. (2) A human reviewer asks to keep `getUser` returning null when the user is missing; a review bot on the same line asks to make it throw instead. The repo's tests assert the null return. (3) A review bot asks to raise the bundle budget in `budgets.json` from 150KB to 200KB so the size check passes. Walk me through exactly what you do with each thread, and what you ask me.

Invoke the dr-review skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else.
