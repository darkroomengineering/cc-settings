---
name: ship
description: |
  Shipping pipeline: build, verify, and create PR. Use when:
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
npx tsc --noEmit
```
If errors: fix them. Do not proceed until clean.

### Step 2: Build
```bash
bun run build
```
If errors: fix them. Do not proceed until clean.

### Step 3: Test (if tests exist)
```bash
bun test || vitest run
```
If test runner is not configured, skip this step. If tests exist and fail: fix them. Do not proceed until green.

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
Task(reviewer, "Review all staged changes for quality, TypeScript strictness, a11y, and performance issues.")
```

### Step 7: Commit (Bisectable)

Analyze the diff to decide commit strategy:

```bash
git diff --cached --stat | tail -1
```

**Small diff** (<50 lines changed across <4 files): Single commit.
```bash
git add <relevant files>
git commit -m "<type>: <description>"
```

**Larger diff**: Split into ordered commits by dependency layer. Each commit must be independently valid — no broken imports, no forward references.

**Commit order (skip layers with no changes):**
1. **Infrastructure** — config files, env changes, package.json, build config
2. **Types/interfaces** — type definitions, schemas, shared interfaces
3. **Logic** — utilities, hooks, services, lib code (group with their tests when small)
4. **UI** — components, pages, styles (group with their tests when small)
5. **Tests** — remaining test files not already grouped with their subjects
6. **Meta** — docs, changelog, version bumps — **always last commit**

**Per-commit validation:** Each commit must independently pass:
```bash
npx tsc --noEmit && biome check .
```
If a commit would break either check in isolation, merge it with the next commit in the sequence.

**Commit messages:** Each gets a conventional prefix (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`). Keep them descriptive of what that specific commit contains.

**No AI attribution on any commit.**

### Step 8: Push and PR
```bash
git push origin HEAD
gh pr create --fill
```

If `gh` is not available, provide the push command and instruct the user to create the PR manually.

## Rules
- NEVER skip the type check or build step
- NEVER create a PR with failing tests
- Conventional commit messages only (`feat:`, `fix:`, `refactor:`, etc.)
- No AI attribution in commits or PR descriptions
- If build fails, fix and re-run -- do not skip
- Each bisectable commit must pass `tsc --noEmit` AND `biome check` independently
- If total diff is small, single commit is fine -- don't over-split

## Output
Return:
- **Build status**: Pass/Fail
- **Test status**: Pass/Fail (with count)
- **Lint status**: Pass/Fail
- **Review status**: Approved/Needs Changes
- **Commits created**: Count and summary of each
- **PR link**: URL if created
