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
2. **Sondeo sweep (if available).** If the repo declares `sondeo` in package.json and `node_modules/.bin/sondeo` exists, run `node_modules/.bin/sondeo report --json` (exit 0 always; operational failure just skips this step). Fold the JSON into the ranking: `byRule` gives per-standard counts, `byArea` names the debt hotspots — cite both in step-4's findings table, and include the `baseline` object verbatim in the report as the ready-to-commit adoption path (`sondeo baseline write` produces exactly these numbers). If sondeo is not installed, note in the output that the repo has no sondeo coverage and that `npm i -D sondeo && npx sondeo baseline write` is the adoption path — do not install anything on an external repo (read-only guardrail applies).
3. Fan out `explore` agents in ONE message:
   - (a) structure + dependency freshness
   - (b) TypeScript/lint/config hygiene
   - (c) obvious perf and a11y issues on key pages
   - (d) security smells (exposed env, secrets in history, unpinned actions)
4. Rank findings: Critical / Should-fix / Cosmetic. Each with `file:line` and a one-line fix sketch. Max 15 findings — this is a triage, not an audit; recommend `/audit maintainability` if depth is warranted.
5. End with a split: "safe to fix directly" vs "needs client conversation".

## Output

- Ranked findings table (Critical / Should-fix / Cosmetic)
- Org-boundary status: internal (fixes allowed) or external (report-only)
- Recommended next skill: `/fix`, `/audit maintainability`, or nothing
