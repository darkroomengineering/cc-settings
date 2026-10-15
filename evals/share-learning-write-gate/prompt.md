---
tags: [share-learning]
max_turns: 6
allowed_tools: [Skill]
---

We just fixed a crash when `user.email` is missing. The fix adds a null guard in the mailer and a test named `handles missing email`, both merged. Share this gotcha with the team.
