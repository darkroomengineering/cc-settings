---
name: triage
description: First-pass review of a client or unfamiliar repo — pull latest, sweep for glaring issues, report ranked findings. READ-ONLY on external repos. Triggers "triage this repo", "point out glaring issues", "review the codebase and tell me what needs fixing", "first pass on this client repo".
context: fork
---

# Repo Triage

First-pass sweep of a repo you didn't build. Output is a report, not a diff.

## Guardrail (non-negotiable)

If the repo's origin is outside the darkroomengineering org: **read-only. Never commit, never push, never open a PR** (incident 2026-07-07). Findings go in the report; the user decides what crosses the org boundary. Check first:

```bash
git remote get-url origin
```

## Pipeline

1. `git checkout main 2>/dev/null; git pull` — triage latest, note the default branch.
2. Fan out `explore` agents in ONE message:
   - (a) structure + dependency freshness
   - (b) TypeScript/lint/config hygiene
   - (c) obvious perf and a11y issues on key pages
   - (d) security smells (exposed env, secrets in history, unpinned actions)
3. Rank findings: Critical / Should-fix / Cosmetic. Each with `file:line` and a one-line fix sketch. Max 15 findings — this is a triage, not an audit; recommend `/nuclear-review` if depth is warranted.
4. End with a split: "safe to fix directly" vs "needs client conversation".

## Output

- Ranked findings table (Critical / Should-fix / Cosmetic)
- Org-boundary status: internal (fixes allowed) or external (report-only)
- Recommended next skill: `/fix`, `/nuclear-review`, or nothing
