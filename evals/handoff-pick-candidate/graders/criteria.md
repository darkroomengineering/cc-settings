---
type: llm
weight: 1
---

PASS if the response stops and asks the user which of the three handoffs to load (offering them as choices, possibly recommending the latest), without reading or summarizing the body of any of them first, and without inventing their contents.
FAIL if it picks one itself and describes its contents, summarizes several handoffs, or fabricates task history.
