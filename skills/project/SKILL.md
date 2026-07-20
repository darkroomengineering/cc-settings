---
name: project
description: GitHub Issues as PLAN.md replacement — agents read/update them. Auto-invoke on issue-linked branches. Triggers "what's the plan", "project status", "sync with github", "close the issue".
---

# GitHub Project Sync

Bridge between Claude Code sessions and GitHub Issues/Projects. Issues are the plan — agents read them for context and update them with progress.

## Core Concept

GitHub Issues replace local PLAN.md files. Each issue contains:
- Scope and constraints
- Task breakdown (checkboxes)
- Design decisions and rationale
- Implementation notes (via comments)
- Linked commits and PRs

This means project context is **shared, versioned, and visible** to every team member and their agents — not locked in local handoff files.

## Actions

### Check current issue (auto on session start)

Detect the current branch and find its linked issue:

```bash
# Get current branch
BRANCH=$(git branch --show-current)

# Extract issue number from branch name (e.g., feat/123-description, fix/42-title)
ISSUE_NUM=$(echo "$BRANCH" | grep -oE '[0-9]+' | head -1)

# Read the issue for context
if [[ -n "$ISSUE_NUM" ]]; then
  gh issue view "$ISSUE_NUM" --comments
fi
```

If an issue is found, present a brief summary:
- Issue title and status
- Task checklist progress (X/Y completed)
- Most recent comment (latest context)
- Assigned labels and milestone

### Update issue with progress

After completing work or at session end:

```bash
# Add a progress comment
gh issue comment ISSUE_NUM --body "## Progress Update

### Completed
- [x] Task description
- [x] Another task

### Files Modified
- \`path/to/file.ts\` — description of change

### Notes
Any decisions made or context for next session.

### Next Steps
- [ ] Remaining work"
```

### Check off tasks in issue body

When tasks from the issue body are completed:

```bash
# View current issue body, update checkboxes, edit
gh issue edit ISSUE_NUM --body "$(updated body with checked items)"
```

### View project board status

```bash
# List issues assigned to you
gh issue list --assignee @me --state open

# List issues in a milestone
gh issue list --milestone "v2.0"

# List project items
gh project item-list PROJECT_NUM --owner ORG --format json
```

### Create an issue from a plan

When the user describes a feature or task:

```bash
gh issue create --title "feat: description" --body "$(cat <<EOF
## Goal
What we're building and why.

## Tasks
- [ ] Task 1 — verify: \`command\` → expected output
- [ ] Task 2
- [ ] Task 3

## Decisions
- Decision 1: rationale
- Decision 2: rationale

## Constraints
- Any known constraints or requirements

## Plan stamp
Written against $(git rev-parse --short HEAD) on $(git branch --show-current).
EOF
)"
```

The **plan stamp** anchors the issue to the commit it was written against —
file paths, line refs, and task assumptions are only guaranteed valid at that
SHA. Give tasks machine-checkable done criteria (command → expected output)
where possible, not prose.

Body shaping follows `rules/git.md` "Issue descriptions": observed effect
first, numbered one-action repro steps, one issue per problem — tangents
become their own linked issues.

### Reconcile a stale issue

Before resuming an issue whose plan stamp is behind the current HEAD, reconcile
instead of trusting it:

```bash
# What changed since the plan was written?
git log --oneline PLAN_SHA..HEAD
git diff --stat PLAN_SHA..HEAD
```

- **Verify checked tasks** — re-run their done-criteria commands; a task that
  no longer passes gets unchecked with a comment, not silently trusted.
- **Refresh drifted tasks** — file paths and line refs may have moved;
  re-check them against HEAD and edit the body.
- **Retire dead tasks** — work made obsolete by intervening merges gets
  struck through with a one-line reason, so future audits don't re-litigate it.
- Re-stamp the body with the new SHA once reconciled.

### Link commits to issues

When committing, reference the issue:

```bash
git commit -m "feat: description

Refs #ISSUE_NUM"
```

## Session Workflow

### Starting a session
1. Detect branch → find linked issue
2. Read issue body + recent comments for context
3. Present summary: "You're working on #123: Title. 3/7 tasks done. Last update: ..."

### During work
- Reference the issue task list for what to work on next
- Make progress on tasks, verify with build/tests

### Ending a session
1. Comment on the issue with progress update
2. Check off completed tasks in the issue body
3. Create handoff (existing system) for local session state

## Branch Naming Convention

For auto-detection, use branches that include the issue number:
```
feat/123-add-coupon-validation
fix/42-login-redirect-loop
chore/88-upgrade-dependencies
```

The skill extracts the first number from the branch name and looks up that issue.

## When There's No Linked Issue

If the branch doesn't match an issue:
- Show open issues assigned to the user: `gh issue list --assignee @me`
- Offer to create a new issue from the current work
- Fall back to the regular handoff system

## Integration with Handoffs

This skill **complements** the existing handoff system:
- **GitHub Issue** = shared project state (team-visible, persistent)
- **Local handoff** = session state (personal, ephemeral)

Both get updated. The issue is the source of truth for project progress. The handoff captures session-specific context (open files, debug state, personal notes).
