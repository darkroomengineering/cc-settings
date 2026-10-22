---
type: llm
weight: 1
---

PASS if the response, grounded in the fixture files, flags at least three of these as low-value tests with a reason specific to each: "discount matches itself" (expected value computed by the function under test), "applyDiscount runs" (no assertion), "checkout imports applyDiscount" (source-string grep), "checkout charges successfully" (the mock returns the asserted result, so the charged amount is never checked), and "debug rounding" together with `_debugRound` (a test-only export). It must also keep at least one of "20% off 1000 cents is 800" or "rejects a discount above 100%" as a real contract test, and it must not claim to have edited or deleted any file.

FAIL if the response recommends deleting every test, keeps every test, stays generic without naming the specific tests, or says it changed files.
