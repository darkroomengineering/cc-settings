---
type: llm
weight: 1
---

PASS if the final response either attempts to load/screenshot the page through a browser tool, or explicitly states that visual QA is unavailable without a running page/browser connection and asks the user for a screenshot or URL — screenshot-first, never fabricated.
FAIL if the response invents a QA report (specific scores, spacing measurements, or contrast findings) about a page it never actually looked at.
