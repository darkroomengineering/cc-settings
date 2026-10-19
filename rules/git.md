---
paths:
  - ".git/**/*"
  - "**/.gitignore"
  - ".github/**/*"
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

## DON'T

- Ambiguous messages (`fix`, `update`, `wip`).
- `--no-verify` without a stated reason.

## PRs

Lead with a plain-English **"What this does"** — 2–3 sentences on the real-world
effect, not the mechanism. Then a technical **Summary** for reviewers, then a
**Test Plan** of bounded, checkable items ("run `bun test`, expect 0 failures"),
never "tested thoroughly".

**Signal, not spam**: every sentence earns its place; explain the why, not the
diff restated in jargon; plain beats impressive; no filler ("This PR introduces
a comprehensive…"). Large diff → number the review order ("start with
`schema.ts`; the rest is fallout"). A bullet list that keeps growing is usually
two PRs.

**Screenshots only for visible changes**: when a PR changes what a user sees,
link the Figma frame or Linear ticket it implements and add a "Screenshots:
before/after needed" line for the author; agents cannot attach images through
`gh`. Refactor, logic, API, and tooling PRs get no screenshots.

**Open a PR by default** — most Darkroom client projects protect `main`. Direct
push to main is the exception for repos that explicitly allow it. Merge only
with CI green, review done, no conflicts, branch up to date.

## Commit and PR mechanics

**Commit with explicit pathspecs.** Write the message to a file and commit the
named paths: `git add <paths>` then `git commit -F <msgfile> -- <paths>`. A bare
`git commit` takes the whole index, including files someone else staged earlier.
Never `git add -A` or `git add .`.

**PR existence check.** `gh pr list --head <branch-name> --state open --json
number,url,headRefName,headRepositoryOwner`, with the branch name only. Only an
exit-0 `[]` means no PR; a non-zero exit means PR state is unknown, so stop
instead of creating one. Never pass `--head owner:branch`: `gh` returns `[]` for
it and the run opens a duplicate PR. With results, match on `headRefName` and the
head owner, and stop on an ambiguous match.

**PR body from a file.** Write the body to a temp file and pass `--body-file
<path>` to `gh pr create` or `gh pr edit`. Stdin, `--body-file -`, an inline
heredoc, and `--body "$(cat ...)"` can produce an empty body while `gh` exits 0.

**PR description source.** Use the repo's own template first (repo root,
`docs/`, `.github/`, `.github/PULL_REQUEST_TEMPLATE/`) and treat it as a minimum:
its headings and checklists stay, and the rules above apply inside them. With no
template, use the structure under "PRs". Derive the summary from the full range
(`git log <base>..HEAD`), never from the latest commit alone. When rewriting an
existing body, keep its `Fixes #` and `Related` lines.

## Issue descriptions

Lead with the observed effect, not the suspected cause ("checkout 500s on
Safari" beats "possible race in session middleware"). Repro steps numbered, one
action per step. One problem per issue; file tangents separately. Planned work
gets bounded, verifiable tasks: one action each, with a check that proves it done.
