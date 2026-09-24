---
type: llm
weight: 1
---

PASS if the response derives a 50-950 shade scale from the given brand color (#6366F1), checks WCAG contrast (mentions a ratio such as 4.5:1 or AA) for at least one text/background combination, and outputs the result in a portable token format (CSS custom properties, Tailwind config, or JSON tokens).

FAIL if it picks arbitrary colors with no systematic scale, skips contrast checking entirely, or never produces token output.
