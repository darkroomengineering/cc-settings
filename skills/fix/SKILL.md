---
name: fix
description: Debug and fix bugs/errors/failures, including merge conflicts and failing PR CI checks. Triggers "fix", "broken", "not working", "bug", "error", "failing", "merge conflict", "fix CI", "checks failing", console errors, build/test failures, regression.
context: fork
---

# Bug Fix Workflow

Before starting work, create a marker: `mkdir -p ~/.claude/tmp && echo "fix" > ~/.claude/tmp/heavy-skill-active && date -u +"%Y-%m-%dT%H:%M:%SZ" >> ~/.claude/tmp/heavy-skill-active`

You are in **Maestro orchestration mode**. Delegate immediately to specialized agents.

## Current State
- Branch: !`git branch --show-current 2>/dev/null || echo "unknown"`
- Recent commits: !`git log --oneline -5 2>/dev/null || echo "no commits"`
- Uncommitted changes: !`git status --porcelain 2>/dev/null | head -10`

## Workflow

1. **Explore** - Spawn `explore` agent to understand the affected codebase area
2. **Reproduce** - Spawn `tester` agent to create a failing test if possible
3. **Diagnose** - Analyze findings to identify root cause
4. **Implement** - Spawn `implementer` agent to fix the issue
5. **Verify** - Spawn `tester` agent to confirm the fix
6. **Learn** - If this was a non-obvious fix, the auto-memory system in `~/.claude/CLAUDE.md` captures it; for team-wide gotchas use `/share-learning` to post to the team-knowledge repo

## Scope Rules

Follow CLAUDE.md Guardrails (scope constraint, 2-iteration limit). Only modify files directly related to the bug.

**Build after every fix**: Run the build after each individual fix attempt. Never stack multiple untested fixes -- verify green before moving on. If the build breaks, fix *that* before continuing.

**Autonomous fix-verify loop**: once the reproducer exists, set
`/goal the reproducer test passes and the full suite is green, or stop after 5 attempts`
to keep iterating without re-prompting. Keep the 2-iteration scope rule in mind when
choosing the stop clause.

## Agent Delegation

Spawn explore and tester first — these accept thin prompts because they
discover what they need from the codebase:

```
Agent(explore, "Investigate the bug: $ARGUMENTS. Find relevant files, trace the issue.")
Agent(tester, "Create a failing test that reproduces: $ARGUMENTS")
```

**Then assemble the implementer prompt from the actual outputs.** Implementer
runs in an isolated worktree with no access to prior agent results, so paste
real content — not placeholders, not references:

- The user's original ask (`$ARGUMENTS`) verbatim
- The exact file paths + line ranges `explore` reported (copy them in)
- The recommended fix `explore` identified, quoted line-by-line — **not** "based on findings"
- The build/test command the tester wrote (or repro steps)
- Scope: "only the files listed above; do not refactor adjacent code"

Now spawn:

```
Agent(implementer, "<the assembled briefing above — all five items inline>")
Agent(reviewer, "Quick review of the fix for quality and edge cases")
```

Skip the implementer step if `explore` reports the bug is non-reproducible or
already fixed in current HEAD.

## Output

Return a concise summary:
- **Root cause**: What was wrong
- **Fix applied**: What changed
- **Files modified**: List of files
- **Verification**: How it was tested
- **Learning stored**: If applicable

## Remember

- If the fix involves a library API, **fetch docs first** via Context7 MCP — APIs change between versions
- Always store non-obvious bug fixes as learnings
- Check if similar bugs were fixed before (recall learnings)
- Run tests after fixing

---

## Variant: Merge Conflicts

If the failure is unresolved git merge conflicts (not a code bug), skip the explore/tester loop:

1. Detect conflicts: `git diff --name-only --diff-filter=U` lists conflicted paths.
2. Resolve each conflict with minimal, correctness-first edits. Prefer preserving both sides when safe; otherwise choose the variant that compiles and keeps public behavior stable.
3. Regenerate lockfiles with the package manager (`bun install`, `npm install`, etc.) rather than hand-editing.
4. Run compile, lint, and relevant tests.
5. Stage resolved files and summarize key decisions in the commit message.

Guardrails:

- Avoid broad refactors while resolving conflicts — separate PR for cleanup.

## Variant: Failing PR CI

If the failure is on a pushed branch with an open PR (not a local bug), use `gh pr checks` as the source of truth — it covers all PR-attached checks, not just GitHub Actions:

1. Resolve the PR: `gh pr view --json number,url,headRefName`.
2. Inspect attached checks: `gh pr checks --json name,bucket,state,workflow,link`.
3. For each failed check, fetch logs:
   - GitHub Actions: `gh run view RUN_ID --log-failed`.
   - External services: follow the check `link` to the provider.
4. Extract the first actionable error. Apply the smallest safe fix.
5. Push and re-check. The check set can change between runs — re-read `gh pr checks` after every push.

Guardrails:

- Fix one actionable failure at a time.
- If the failure is clearly unrelated to the PR and already fixed on main, merge main into the branch instead of bloating the PR with unrelated fixes.
- For flaky checks, retry once and report flake evidence rather than chasing a phantom fix.
