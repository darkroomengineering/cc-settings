---
type: llm
weight: 1
---

PASS if the response names concrete, specific issues grounded in the actual fixture files — such as the near-duplicate logic between utils/formatCurrency.ts and utils/formatMoney.ts, or the unused legacy/oldReportGenerator.ts file — and organizes the findings with some form of priority or severity rather than generic praise.

FAIL if the response is generic (no reference to the specific files/functions), only compliments the code, or fails to flag the duplication or dead code that are present in the fixture.
