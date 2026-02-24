---
name: project
description: |
  GitHub-native project management. Syncs agent context with GitHub Issues and Projects.

  AUTO-INVOKE on session start when a branch is linked to an issue.

  Also invoke when user says:
  - "what's the plan", "project status", "update the issue"
  - "sync with github", "check the roadmap"
  - "what am I working on", "show my tasks"
  - "close the issue", "mark as done"
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
gh issue create --title "feat: description" --body "$(cat <<'EOF'
## Goal
What we're building and why.

## Tasks
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

## Decisions
- Decision 1: rationale
- Decision 2: rationale

## Constraints
- Any known constraints or requirements
EOF
)"
```

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
