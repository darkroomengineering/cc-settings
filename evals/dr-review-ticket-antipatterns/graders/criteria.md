---
type: llm
weight: 1
---

The fixture `tickets.md` is a thin first pass: US-1 is a parent with no criteria of its own ("done when every sub-issue is done"); US-1a and US-1b have criteria naming files, intervals, events and metafields; every design reference is a bare Figma node ID; the same three-line Verify block is pasted into three tickets; US-1a is Done with a closing comment that says it was verified by reading the code.

PASS if the review flags all five: the container parent (US-1), implementation detail in the criteria (US-1a or US-1b), the bare node IDs, the copied Verify block (saying it belongs once in a kickoff or shared doc), and US-1a marked done from a reasoned check rather than a seen one. The verdict is not READY or APPROVED.

FAIL if any of the five is missing, if it edits `tickets.md`, or if it approves the tickets.
