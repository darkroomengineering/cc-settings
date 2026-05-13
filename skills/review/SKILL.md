---
name: review
description: Local pre-commit review of unstaged/staged diff against the Darkroom quality checklist (TypeScript, React, a11y, perf, security). Distinct from native /review which inspects open PRs. Triggers "review my changes", "check this diff", "feedback on this code", post-implementation self-review before commit.
context: fork
agent: reviewer
---

# Code Review

Reviews against the full Darkroom quality checklist defined in the reviewer agent.

Focus areas: TypeScript strictness, React patterns, accessibility, performance, security, file structure.

## Current State
- Branch: !`git branch --show-current 2>/dev/null || echo "unknown"`
- Staged files: !`git diff --staged --stat 2>/dev/null || echo "nothing staged"`
- Unstaged files: !`git diff --stat 2>/dev/null || echo "nothing unstaged"`

## Get Changes

```bash
# Unstaged changes
git diff

# Staged changes
git diff --staged

# Specific file
git diff path/to/file
```

## Output Format

```
## Summary
[1-2 sentence overview]

## Critical Issues
- [Must fix before merge]

## Warnings
- [Should fix, but not blocking]

## Suggestions
- [Nice to have improvements]

## Verdict
[APPROVED / NEEDS CHANGES / BLOCKED]
```

## Remember

- Be constructive, not just critical
- Explain WHY something is an issue
- Suggest specific fixes
- If you find a pattern worth remembering, save it via auto-memory (personal) or `/share-learning` (team-wide).
