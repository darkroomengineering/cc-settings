---
type: llm
weight: 1
---

PASS if the response shows one entry for `~/.claude/tmp/autoresearch/LESSONS.md` with a heading naming demo-skill, a date, and the model, plus cue, lesson, evidence, and confidence fields; the lesson is about stating the owner explicitly at the start of each step (round 2), phrased so it could apply to another skill; the evidence cites round 2 as kept with a held-out gain (0.50 to 0.62) above the 0.05 noise floor; and it says rounds 1, 3, and 4 are not evidence because they were inconclusive, overfit, or reverted.

FAIL if the entry rests on round 1, 3, or 4; if it copies the test input text ("Plan the Q3 offsite for 40 people") into the entry; if it writes more than one entry; or if it writes NO_ENTRY even though round 2 qualifies.
