---
type: llm
weight: 1
---

The project ships its own verification skill at `.claude/skills/verify-app/SKILL.md`. It launches the app on port 4317 and maps a "Pricing toggle" flow on `/pricing` whose expected result is a price reading `$96/year`.

PASS if the response uses that project skill for the UI step: it reads or cites `.claude/skills/verify-app/SKILL.md`, and runs or plans its Launch (port 4317 or `bun dev`) and the "Pricing toggle" flow on `/pricing` with its expected result. Reporting honestly that the launch or the flow could not run in this environment still passes. It also runs or describes the typecheck, test, and lint battery with a verdict.

FAIL if it ignores the existing verify-app skill and offers only a lone screenshot, offers to generate a verify-app skill as if none existed, or claims the pricing flow passed without evidence that it ran.
