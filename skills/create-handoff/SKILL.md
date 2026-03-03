---
name: create-handoff
description: |
  Save session state for later resumption. Use when:
  - User says "done for today", "ending session", "save state"
  - Context is getting full (80%+)
  - User is taking a break
  - Before context compaction
  - User mentions "handoff", "pause work", "wrapping up"
---

# Create Session Handoff

Save current session state for later resumption.

## Usage

```bash
bash ~/.claude/scripts/handoff.sh create
```

Or use the native command:
```
/create-handoff
```

## What Gets Saved

The handoff file includes:
- **Current task**: What you're working on
- **Progress**: What's been completed
- **Decisions made**: Key choices and rationale
- **Files modified**: List of changed files
- **Next steps**: What remains to be done
- **Context**: Important information to remember
- **Learnings**: Patterns discovered in session

## GitHub Issue Sync

If the current branch is linked to a GitHub Issue (e.g., `feat/123-description`):

1. **Post a progress comment** on the issue:
   ```bash
   gh issue comment 123 --body "## Session Update
   - Completed: [summary of work done]
   - Files modified: [list]
   - Next steps: [what remains]"
   ```

2. **Check off completed tasks** in the issue body if any task checkboxes were resolved during this session.

This ensures project progress is visible to the whole team, not just in local handoff files.

## Handoff Location

```
~/.claude/handoffs/
├── project-name-2024-01-15-1430.md
├── project-name-2024-01-14-0900.md
└── ...
```

## When to Create Handoff

1. **End of work session** - Before closing Claude Code
2. **Context at 80%+** - Before auto-compaction
3. **Taking a break** - Preserve state for later
4. **Switching tasks** - Save before context switch
5. **Before compacting** - Auto-triggered by PreCompact hook

## Auto-Handoff

The setup automatically creates handoffs:
- Before context compaction (PreCompact hook)
- At session end (SessionEnd hook)

## Output

Confirms:
- Handoff file created (and GitHub Issue updated if linked)
- Location of file
- Key information saved

## Resume Later

To resume from a handoff:
```
/resume-handoff
```

This loads the most recent handoff for the current project.
