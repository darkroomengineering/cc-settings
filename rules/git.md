---
paths:
  - ".git/**/*"
  - "**/*"
---

# Git

> Conventional commits, atomic changes, protected branches

---

## DO

### Conventional Commits
```bash
feat: add user authentication flow
fix: resolve race condition in checkout
refactor: extract payment logic to service
docs: update API documentation
chore: upgrade dependencies
test: add unit tests for auth module
```

### Atomic Commits & Clear Messages
```bash
# One logical change per commit
git commit -m "feat: add login form component"
git commit -m "feat: add login API endpoint"

# With body for complex changes
git commit -m "feat: implement OAuth2 authentication

Add Google and GitHub OAuth providers with automatic
account linking for existing users."
```

### Verify Before Destructive Operations
```bash
git status && git diff          # Always check first
git log --oneline -10           # Review before reset
git reset --soft HEAD~1         # Prefer soft reset
```

### Feature Branches
```bash
git checkout -b feat/user-profile
git checkout -b fix/login-redirect
```

### Proper File Untracking
When removing a tracked file from git but keeping it locally:
```bash
git rm --cached <file>        # Untrack without deleting
echo "<file>" >> .gitignore   # Prevent re-tracking
git commit -m "chore: untrack <file>"
```
Adding to `.gitignore` alone does NOT remove already-tracked files. You must use `git rm --cached`.

---

## DON'T

```bash
# WRONG: Force push to main
git push --force origin main

# WRONG: Ambiguous messages
git commit -m "fix"
git commit -m "update"
git commit -m "wip"

# WRONG: Skip hooks without reason
git commit --no-verify

# WRONG: Any AI attribution in commits or PRs
Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
# WRONG: AI badges in PR descriptions
🤖 Generated with [Claude Code](https://claude.com/claude-code)
# CORRECT: No attribution, no AI mentions, nothing
```

### Never Commit Secrets

See `rules/security.md` for the secret file list and rationale.

---

## PR Guidelines

Lead every PR with a plain-English summary. Our default failure mode is
descriptions that read as technical and over-engineered — the diff restated in
jargon. Write for a teammate who didn't write the code (and for future you).

```markdown
## What this does
2–3 plain sentences: what changed and why it matters — the problem it solves or
the behaviour it changes. Name the real-world effect ("login now survives a
refresh"), not the mechanism ("refactored the auth persistence layer").

## Summary
Technical bullets — the *how*, for reviewers reading the code.

## Test Plan
- [ ] Unit tests pass
- [ ] Manual testing completed
```

**Signal, not spam** — the bar for "What this does":
- Every sentence earns its place. If a line only narrates the code, cut it.
- Explain the *why*, not just the *what*. One why is good; the why behind it is better.
- Don't make a small change sound big. Plain beats impressive.
- No jargon dump, no restating the diff, no filler ("This PR introduces a comprehensive…").
- If you can't say what it does in plain English, that's a signal the change is unclear — not a reason to reach for bigger words.

**Action-first shaping** — the reviewer's working memory is the constraint
(same principle as the always-on Action-First Output rules):
- "What this does" is the TL;DR: a reviewer should know what to check from it alone.
- Large diff? Number the review order ("start with `schema.ts`; the rest is fallout").
- Test-plan items are bounded, checkable actions ("run `bun test`, expect 0 failures"), never "tested thoroughly".
- Cap any list at 5. Past five bullets, the PR is probably two PRs.

### Issue descriptions

Same constraint, different reader — someone deciding whether to pick this up:
- Lead with the observed effect, not the suspected cause ("checkout 500s on
  Safari" beats "possible race in session middleware").
- Repro steps numbered, one action per step.
- One issue per problem. File the tangent as its own issue and link it.
- If work is planned, tasks are bounded and verifiable — see the `/project`
  skill's issue template ("verify: `command` → expected output").

### Open a PR by default
Default to a feature branch + PR, even for small changes — most Darkroom client
projects protect `main` and review through PRs. Direct `git push origin main` is
the exception, reserved for repos that explicitly allow it and changes that are
trivial and self-evident. When unsure, open a PR.

### Before Merging
- CI passes, code reviewed, no conflicts, branch up to date

## Branch Protection (main)
- Require PR reviews
- Require status checks
- No force pushes
- No deletions

## Tools
- **Biome** - Pre-commit formatting
- **husky** - Git hooks
- **commitlint** - Commit conventions
