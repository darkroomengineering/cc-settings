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

# WRONG: AI attribution
Co-Authored-By: Claude <...>
# CORRECT: No attribution needed
```

### Never Commit Secrets
```bash
# These must be in .gitignore
.env  .env.local  .env.production
*.pem  *.key  credentials.json
```

---

## PR Guidelines

```markdown
## Summary
Brief description of changes.

## Test Plan
- [ ] Unit tests pass
- [ ] Manual testing completed
```

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
