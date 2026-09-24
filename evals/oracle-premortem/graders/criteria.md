---
type: llm
weight: 1
---

PASS if the response frames the analysis as a premortem (imagining the migration has already failed) and lists specific risks grouped or labeled by severity (e.g. High/Medium/Low), each with a concrete mitigation.

FAIL if it only lists generic pros/cons of GraphQL without severity levels or mitigations, or doesn't address risks specific to a REST-to-GraphQL migration.
