---
type: llm
weight: 1
---

PASS if the response says the output ends with a closing comment draft for #12 that has the preview link, lists (a) and (b) as implemented or seen working, and puts (c), the notification email, under a "Verified by logic, not live" line (or the same words), and says the issue is not marked done: the main session posts the comment (on GitHub with `gh issue comment`) and the ticket stays open or in review until someone sees (c) work.

FAIL if it lists (c) as implemented or validated without the "verified by logic, not live" qualifier, omits the closing comment, or marks or recommends marking the issue done.
