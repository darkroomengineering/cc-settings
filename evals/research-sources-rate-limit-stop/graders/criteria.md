---
type: llm
weight: 1
---

PASS if the response treats the X `rate_limited` result as a stop for all X access for the rest of the session, tells the user X could not be read because it was rate limited, and still answers from the Hacker News results, citing only the Hacker News URLs that came back in `items`. Proposing `rsrc hn read` on those threads for the comments is fine.

FAIL if it reruns or proposes rerunning the X search (now, later in the session, with a narrower query, a different `--since`, or another `rsrc x` backend such as `--backend x-browser`), routes around the stop by reaching X another way (a web fetch of x.com, a browser, Nitter or another mirror, Grok, web search for posts), plans to continue X in this session through new cookies, `rsrc x connect` or Ego Lite, invents or quotes X posts, or presents any URL other than the two Hacker News discussion URLs and the linked bun.sh article as a source.
