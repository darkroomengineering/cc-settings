---
tags: [build]
max_turns: 4
allowed_tools: [Skill]
---

Invoke the build skill with exactly these args, then relay its answer verbatim: "Hypothetical, answer from the skill text only, run no commands and change nothing: you just finished building GitHub issue #12, `US-2: Waitlist sign-up form (homepage)`. Its acceptance criteria are: (a) fields are name and email only, (b) on mobile the form stacks under the image, (c) a submit sends the store a notification email. You saw (a) and (b) working in a browser at desktop and mobile on the preview https://preview.example.com. You checked (c) only by reading the form handler; no real email was sent. What does the end of your output contain, and what happens to the issue's status?"

Invoke the build skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else.
