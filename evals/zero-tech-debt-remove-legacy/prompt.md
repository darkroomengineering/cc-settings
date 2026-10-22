---
tags: [zero-tech-debt]
max_turns: 14
allowed_tools: [Read, Glob, Grep, Edit, Write, Skill]
---

The legacyCompactMode flag on Widget in fixtures/widget.ts has been dead for months — nobody passes it anymore. Zero tech debt this: kill the legacy path.
