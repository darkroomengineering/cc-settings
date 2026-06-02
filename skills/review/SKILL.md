---
name: review
description: Local pre-commit review of unstaged/staged diff against the Darkroom quality checklist (TypeScript, React, a11y, perf, security). Also summarizes inbound PR review comments on the active PR. Distinct from native /review which inspects open PRs. Triggers "review my changes", "check this diff", "feedback on this code", "PR comments", "what did reviewers say", "summarize PR feedback", post-implementation self-review before commit.
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
[1-2 plain-English sentences: what this change does, then your overall read]

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
- Comments in plain English — explain the issue and its impact like you're talking to a teammate, not citing a rulebook. No jargon dump.
- Suggest specific fixes
- If you find a pattern worth remembering, save it via auto-memory (personal) or `/share-learning` (team-wide).

---

## Variant: Summarize Inbound PR Comments

When the user asks "what did reviewers say" or wants a digest of feedback on the active PR (not a self-review of local diff):

1. Resolve the active PR for the current branch.
2. Fetch review comments (file/line-anchored) and discussion comments (issue-level).
3. Group by severity — blocking, suggestion, nit, open question.
4. Return an action list ordered by priority.

### Commands

```bash
# Resolve the active PR
gh pr view --json number,url,headRefName,reviews,comments

# Inline review comments (file/line anchored)
gh api repos/{owner}/{repo}/pulls/PR_NUMBER/comments \
  --jq '.[] | {user: .user.login, body, path, line}'

# Discussion comments (issue-level, not file-anchored)
gh api repos/{owner}/{repo}/issues/PR_NUMBER/comments \
  --jq '.[] | {user: .user.login, body, created_at}'

# Review states (APPROVED / CHANGES_REQUESTED / COMMENTED)
gh pr view --json reviews --jq '.reviews[] | {user: .author.login, state, body}'
```

### Output Format

```
## Summary
[1-2 sentence overview of feedback]

## Blocking (must address)
- [reviewer]: [path:line] — [issue + suggested fix]

## Suggestions (should address)
- [reviewer]: [path:line] — [issue]

## Nits (optional)
- [reviewer]: [path:line] — [issue]

## Open questions
- [unresolved threads needing a reply]
```

### Guardrails

- Quote actual reviewer text. Do not paraphrase in ways that change meaning.
- Group by severity, not by reviewer.
- If a reviewer didn't mark severity explicitly, infer from language ("must", "should", "consider", "nit:").
