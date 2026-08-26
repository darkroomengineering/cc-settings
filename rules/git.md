---
paths:
  - ".git/**/*"
  - "**/*"
---

# Git

> Conventional commits, atomic changes, protected branches

## DO

- **Conventional commits**: `feat:` / `fix:` / `refactor:` / `docs:` / `chore:` /
  `test:` — one logical change per commit, imperative subject, body only when
  the why needs explaining.
- **Verify before destructive operations**: `git status && git diff` first;
  review `git log --oneline -10` before any reset; prefer `git reset --soft`.
- **Feature branches**: `feat/user-profile`, `fix/login-redirect`.
- **Untrack without deleting**: `git rm --cached <file>` + add to `.gitignore` —
  gitignore alone does NOT remove already-tracked files.
- **Never commit secrets**: see `rules/security.md` for the file list.

## DON'T

- Force-push to main.
- Ambiguous messages (`fix`, `update`, `wip`).
- `--no-verify` without a stated reason.
- **Any AI attribution in commits or PRs** — no `Co-Authored-By: Claude`, no
  "Generated with Claude Code" badges, no AI mentions. Nothing.

## PRs

Lead with a plain-English **"What this does"** — 2–3 sentences on the real-world
effect, not the mechanism. Then a technical **Summary** for reviewers, then a
**Test Plan** of bounded, checkable items ("run `bun test`, expect 0 failures"),
never "tested thoroughly".

**Signal, not spam**: every sentence earns its place; explain the why, not the
diff restated in jargon; plain beats impressive; no filler ("This PR introduces
a comprehensive…"). Large diff → number the review order ("start with
`schema.ts`; the rest is fallout"). Cap any list at 5 — past five bullets it's
probably two PRs.

**Open a PR by default** — most Darkroom client projects protect `main`. Direct
push to main is the exception for repos that explicitly allow it. Merge only
with CI green, review done, no conflicts, branch up to date.

## Issue descriptions

Lead with the observed effect, not the suspected cause ("checkout 500s on
Safari" beats "possible race in session middleware"). Repro steps numbered, one
action per step. One problem per issue; file tangents separately. Planned work
gets bounded, verifiable tasks — see the `/project` skill's issue template.

## Tools

**Biome** (pre-commit formatting) · **husky** (hooks) · **commitlint** (conventions)
