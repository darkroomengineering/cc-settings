---
name: resume-handoff
description: Resume work from prior session via handoff file. Triggers "resume", "continue where we left off", "pick up where", "last session", "previous work".
---

# Resume Session Handoff

Load state from a previous session and continue work.

## Usage

```bash
bun ~/.claude/src/scripts/handoff.ts resume
```

Or use:
```
/resume-handoff
```

## What Gets Loaded

- **Previous task**: What you were working on
- **Progress**: What was completed
- **Decisions**: Key choices made
- **Files modified**: What was changed
- **Next steps**: What remains
- **Context**: Important information

## GitHub Issue Context

Before loading the local handoff, check for a linked GitHub Issue:

```bash
BRANCH=$(git branch --show-current)
ISSUE_NUM=$(echo "$BRANCH" | grep -oE '[0-9]+' | head -1)

if [[ -n "$ISSUE_NUM" ]]; then
  gh issue view "$ISSUE_NUM" --comments
fi
```

If an issue is found, **present it as the primary context** — it's the shared source of truth. The local handoff supplements it with session-specific details.

Present a combined summary:
- **From GitHub Issue**: Title, task progress (X/Y done), latest comments
- **From local handoff**: Session-specific notes, open files, debug state

## Available Handoffs

List handoffs for current project:
```bash
ls ~/.claude/handoffs/ | grep "$(basename $(pwd))"
```

## Resume Options

### Most Recent
```
/resume-handoff
```
Loads the most recent handoff for current project.

### Specific Handoff
```
/resume-handoff project-name-2024-01-15-1430
```
Loads a specific handoff file.

### List All
```
/resume-handoff list
```
Shows available handoffs.

## Workflow

1. **Check GitHub Issue** - Read linked issue for shared project context
2. **Load local handoff** - Read session-specific state
3. **Review combined context** - Understand where we left off
4. **Verify files** - Check current state vs handoff
5. **Continue work** - Pick up next steps from the issue task list

## Automatic Session Start

When starting a new session, the setup automatically:
- Checks for linked GitHub Issue (reads context)
- Recalls project learnings
- Shows recent handoff if available
- Displays context from previous work
