---
name: triage
description: First-pass, read-only review of a client or unfamiliar repo with ranked glaring issues. Triggers "triage this repo", "point out glaring issues", "first pass on this client repo".
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

When an already running browser target is available, add a brief exploratory
pass. Use an isolated session and walk the primary journey from the main
navigation. Sample relevant empty and invalid states, back navigation, deep
links, and narrow viewports. Keep interactions read-only on external
repositories. Record confirmed issues as you go with the route, repro steps,
and browser evidence. Close the session you opened and report the journeys
exercised and any you skipped.

1. Record the current state with `git branch --show-current`, `git status --short`, `git log -1 --oneline`, and `git remote get-url origin`. Do not checkout, pull, fetch, reset, stash, or otherwise change an external repository. State that freshness against the remote is unknown unless the current checkout already contains evidence that proves it.
2. **Farolero coverage check.** Read `package.json` and record whether the repository declares `farolero`. Do not execute repository binaries during read-only triage, including `node_modules/.bin/farolero`: executable project dependencies can mutate state or expose credentials. If coverage is absent, note that `bun add -D farolero && bunx farolero baseline write` is an adoption path for the repository owner to run later. Do not install anything on an external repo.
3. Fan out `explore` agents in ONE message:
   - (a) structure + dependency freshness
   - (b) TypeScript/lint/config hygiene
   - (c) obvious perf and a11y issues on key pages
   - (d) security smells (exposed env, secrets in history, unpinned actions)
4. Rank findings: Critical / Should-fix / Cosmetic. Give each a source location or browser reproduction with evidence, plus a one-line fix sketch. Cap the report at 15 findings and recommend `/audit codebase` when more depth is warranted.
5. End with a split: "safe to fix directly" vs "needs client conversation". State the org-boundary status (internal: fixes allowed; external: report-only) and the recommended next skill: `/fix`, `/audit codebase`, or nothing.
