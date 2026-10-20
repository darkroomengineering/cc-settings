---
type: llm
weight: 1
---

PASS if the response picks item 3 as the target, explains that samples of the same input disagree on it (Test 1 and Test 2 each split one YES, one NO), so the skill leaves that step to chance, and treats item 5 as a likely ambiguous-input or checklist problem to inspect because it passes or fails consistently per input (all YES on Test 1, all NO on Tests 2 and 3).

FAIL if the response targets item 5, treats the two items as interchangeable because their pass rates tie, or picks item 3 only by order or at random without citing the split between samples of the same input.
