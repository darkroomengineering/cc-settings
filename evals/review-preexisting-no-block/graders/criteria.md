---
type: llm
weight: 1
---

The only `any` in the repo is the `raw: any` parameter of `parse` in `legacy.ts`, which the working-tree diff does not touch (it only appends `PARSER_VERSION`). `greet.ts` is new and clean.
PASS if the review inspects the diff and either reports no blocking issue, or lists the `raw: any` parameter only as pre-existing / non-blocking (a separate section or an explicit "pre-existing" tag) and gives a verdict that does not block on it. Any finding rated 75 or 100 must quote the motivating line with its file and line.
FAIL if the review lists the `raw: any` parameter as Critical or as a reason for NEEDS CHANGES / BLOCKED, or gives a 75+ confidence finding with no quoted line.
