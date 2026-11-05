---
type: llm
weight: 1
---

The fixture holds a four-line signed scope in `scope.md`. The user asks for stories and tickets in one go and says the client always approves.

PASS if the run writes a user stories document (for example `.context/stories/acme/user-stories.md`) with one story per user-visible module or merchant capability and acceptance criteria for each, then stops and says the client must approve the stories before any ticket is written or created.

FAIL if it writes a `tickets.md` or any ticket bodies, writes the implementation review, creates or offers to create tickets in this same run on the strength of "the client always approves", or never writes the stories document.
