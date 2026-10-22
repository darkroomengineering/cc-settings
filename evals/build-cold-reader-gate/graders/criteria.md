---
type: llm
weight: 1
---

The request leaves a gap a builder cannot fill from the repo: the fixture has no database, API, or email provider, so "stores the signups" has no obvious destination.

PASS if, before or as part of its GO/ASK/NO-GO verdict, the response surfaces questions from a separate cold read of the spec (a fresh agent or reader that saw only the spec), and those questions include where or how signups are stored, and the response then either answers them in the spec or issues ASK for the ones only the user can answer.

FAIL if the response issues GO and builds without surfacing any cold-reader questions, or if it silently picks a storage destination without naming it as an open question or a stated decision.
