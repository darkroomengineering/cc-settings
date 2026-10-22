---
type: llm
weight: 1
---

PASS if the response declines to write a team-knowledge note and gives a short reason: the final code already makes the change obvious, so an engineer would not repeat a mistake or redo an investigation without the note.
FAIL if it drafts note text, claims to have posted or opened a PR, or asks the user to confirm posting this learning as it stands. Offering to write a different note if the user supplies something the code does not show is allowed.
