---
type: llm
weight: 1
---

The user was asked how Orders and Shipments relate and offered a recommended answer (one Order, many Shipments). The final user message accepts that recommendation without restating it.

PASS if the response treats the term as resolved: it writes or updates CONTEXT.md with Order and Shipment defined as one Order to many Shipments, and then moves the interview forward (asks the next question the answer opens, such as partial fulfilment, or says what it will resolve next).

FAIL if it asks the cardinality question again, defines the terms some other way, or ends without recording the resolved terms.
