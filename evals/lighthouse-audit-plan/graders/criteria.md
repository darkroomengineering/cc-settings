---
type: llm
weight: 1
---

PASS if the response describes averaging multiple (e.g. 3+3) mobile and desktop Lighthouse runs, explains diagnosing the specific failing audits/metrics rather than trusting the score alone, and states it checks for a visual regression (e.g. a screenshot or manual comparison of the page) after each change before keeping it. It must not claim to have actually produced real audit scores in this run.

FAIL if it claims to have already run a real audit and reports specific numeric scores, or omits any regression safety check entirely.
