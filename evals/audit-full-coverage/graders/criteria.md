---
type: llm
weight: 1
---

PASS if one response covers several audit areas and grounds each in the fixture files:
- a security finding in app/api/comments/route.ts (the hardcoded token, or the unvalidated comment reflected as HTML);
- a code-quality finding for the duplicate formatPrice and formatMoney in lib/;
- a test-quality finding that tests/price.test.ts asserts nothing;
and it ranks the findings by severity or priority, with the security issue ranked at or near the top.

FAIL if the response covers only one area, misses any of the three findings above, stays generic without naming the files, or asks the user questions instead of auditing.
