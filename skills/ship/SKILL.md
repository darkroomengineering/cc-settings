---
name: ship
description: Verify and publish changes — push, open PR, watch CI until green. Triggers "ship it", "create PR", "open PR", "ready to merge", "/pr", "/ship", "push and PR", "watch the PR", "babysit CI", "loop until green".
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

### Step 0: Preflight
```bash
ssh-add -l
```
If no identities loaded: **Unlock 1Password and retry — git signing will fail otherwise.** Agent drops mid-flow are a recurring cause of failed pushes; catch it now, not after the commit.

Do not commit until Steps 1–4 (typecheck/build/test/lint) are green. Skipping ahead is where amend churn comes from — `--amend` to fix a lint error you would have caught in 30 seconds invalidates signatures and CI runs.

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
```

If `gh` is not available, provide the push command and instruct the user to create the PR manually.

**Author the PR body — do NOT use `--fill`.** `--fill` dumps the commit messages
into the description, which reads as technical and over-engineered. Lead with a
plain-English "What this does" (see `rules/git.md` "Signal, not spam"):

```bash
gh pr create --title "<type>: <concise, plain-English title>" --body "$(cat <<'EOF'
## What this does
<2–3 plain sentences: what changed and why it matters — the real-world effect,
not the mechanism. A teammate who didn't write it should get it on one read.>

## Summary
- <technical bullet — the how>

## Test Plan
- [ ] <how it was verified>
EOF
)"
```

Write "What this does" from the *diff and its purpose*, not by pasting commit
subjects. If you can't explain it plainly, the change is unclear — say so, don't
reach for bigger words.

### Step 9: Watch CI Until Green (post-push)

After `gh pr create`, watch the PR-attached checks until all pass. Use `gh pr checks` as the source of truth — it covers all PR checks, not just GitHub Actions runs (which `gh run list` would miss).

```bash
gh pr checks --json name,bucket,state,workflow,link
gh pr checks --watch --fail-fast
```

If a check fails:

1. Identify the failing job and fetch logs (`gh run view RUN_ID --log-failed` for GHA; follow the `link` for external services).
2. Apply the smallest fix. Use the `fix` skill's "Variant: Failing PR CI" if the failure is non-trivial.
3. Push, then re-read `gh pr checks` — the check set can change between runs.
4. Repeat until green.

Guardrails:

- Scope each fix to a single failure cause.
- If failures are flaky, retry once and report flake evidence rather than chasing a phantom fix.
- If the failure is unrelated to the PR and already fixed on main, merge main into the branch instead of bloating the PR.

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
