---
name: ship
description: |
  Use when:
  - User says "ship it", "create PR", "open PR", "ready to merge"
  - User says "/pr", "/ship", "push and PR"
  - After implementation is complete and needs to be shipped
  - User wants to verify and publish changes
context: fork
---

# Ship Pipeline

Before starting work, create a marker: `mkdir -p ~/.claude/tmp && echo "ship" > ~/.claude/tmp/heavy-skill-active && date -u +"%Y-%m-%dT%H:%M:%SZ" >> ~/.claude/tmp/heavy-skill-active`

You are in **Maestro orchestration mode**. Execute the shipping checklist in order.

## Current State
- Branch: !`git branch --show-current 2>/dev/null || echo "unknown"`
- Working tree: !`git status --porcelain 2>/dev/null | head -20`
- Recent commits: !`git log --oneline -5 2>/dev/null || echo "no commits"`

## Pipeline (All Steps Mandatory)

### Step 1: Type Check
```bash
bunx tsc --noEmit
```
If errors: fix them. Do not proceed until clean.

### Step 2: Build
```bash
bun run build
```
If errors: fix them. Do not proceed until clean.

### Step 3: Test (if tests exist)

**3a. Affected tests first (when `tldr` is available).** Run only the tests touched by your changes, before the full suite. Fast feedback if you broke something obvious:

```bash
tldr change-impact --project . 2>/dev/null
```

If TLDR returns a list, run those tests first (`bun test <file>` or `vitest run <file>`). If they fail, fix before the full run — don't waste cycles on the rest.

**3b. Full suite.**

```bash
bun test || vitest run
```

If test runner is not configured, skip this step. If tests fail: fix them. Do not proceed until green.

### Step 4: Lint
```bash
biome check .
```
If errors: fix or justify.

### Step 5: Web Quality Gate
Quick sanity check before review:
- [ ] No `loading="lazy"` on above-fold/LCP images
- [ ] Images have explicit dimensions or `fill` prop
- [ ] No `console.log` left in production code
- [ ] Meta tags present on new pages (`title`, `description`, `canonical`)
- [ ] Structured data valid on new content pages

If issues found: fix them before proceeding to review.

### Step 6: Review Changes
Spawn `reviewer` agent:
```
Agent(reviewer, "Review all staged changes for quality, TypeScript strictness, a11y, and performance issues.")
```

### Step 7: Commit and PR
```bash
git add <relevant files>
git commit -m "<type>: <description>"
git push origin HEAD
gh pr create --fill
```

## Rules
- NEVER skip the type check or build step
- NEVER create a PR with failing tests
- Conventional commit messages only (`feat:`, `fix:`, `refactor:`, etc.)
- No AI attribution in commits or PR descriptions
- If build fails, fix and re-run -- do not skip

## Output
Return:
- **Build status**: Pass/Fail
- **Test status**: Pass/Fail (with count)
- **Review status**: Approved/Needs Changes
- **PR link**: URL if created
