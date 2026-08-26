---
name: triage
description: First-pass review of a client or unfamiliar repo — sweep for glaring issues, report ranked findings. READ-ONLY on external repos. Triggers "triage this repo", "point out glaring issues", "first pass on this client repo".
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

1. Record the current state with `git branch --show-current`, `git status --short`, `git log -1 --oneline`, and `git remote get-url origin`. Do not checkout, pull, fetch, reset, stash, or otherwise change an external repository. State that freshness against the remote is unknown unless the current checkout already contains evidence that proves it.
2. **Farolero coverage check.** Read `package.json` and record whether the repository declares `farolero`. Do not execute repository binaries during read-only triage, including `node_modules/.bin/farolero`: executable project dependencies can mutate state or expose credentials. If coverage is absent, note that `bun add -D farolero && bunx farolero baseline write` is an adoption path for the repository owner to run later. Do not install anything on an external repo.
3. Fan out `explore` agents in ONE message:
   - (a) structure + dependency freshness
   - (b) TypeScript/lint/config hygiene
   - (c) obvious perf and a11y issues on key pages
   - (d) security smells (exposed env, secrets in history, unpinned actions)
4. Rank findings: Critical / Should-fix / Cosmetic. Each with `file:line` and a one-line fix sketch. Max 15 findings — this is a triage, not an audit; recommend `/audit codebase` if depth is warranted.
5. End with a split: "safe to fix directly" vs "needs client conversation".

## Output

- Ranked findings table (Critical / Should-fix / Cosmetic)
- Org-boundary status: internal (fixes allowed) or external (report-only)
- Recommended next skill: `/fix`, `/audit codebase`, or nothing
