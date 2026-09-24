---
type: llm
weight: 1
---

PASS if the final response is structured as an adversarial verification report with an explicit verdict (PASS/FAIL/NEEDS REVIEW), and it flags the hardcoded `"letmein"` token backdoor as a confirmed issue.
FAIL if it misses the backdoor entirely, or skips straight to "looks good" without a structured verdict.
