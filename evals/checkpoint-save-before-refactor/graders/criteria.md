---
type: llm
weight: 1
---

PASS if the response identifies this as a checkpoint `save` operation (not restore, list, show, or clean) and gives it a descriptive label referencing the auth middleware / session library refactor, matching the checkpoint runner's `save [label]` subcommand.

FAIL if the response chooses the wrong subcommand (e.g. restore, list, clean) for a "checkpoint before I start this" request, or saves with no meaningful label at all.
