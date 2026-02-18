# Checkpoint System

Save and restore state for long-running tasks. Enables recovery from interruptions and context window exhaustion.

## When to Checkpoint

- **Milestones**: After completing a logical phase of work
- **Context Thresholds**: Automatically at 70%, 80%, 90% context usage
- **Before Risky Operations**: Schema changes, large refactors, dependency upgrades
- **After Verification Passes**: Lock in known-good state

## Checkpoint Contents

```json
{
  "id": "chk-20240115-103000",
  "timestamp": "2024-01-15T10:30:00Z",
  "project": "my-app",
  "phase": "3/6",
  "description": "Completed component migration",
  "git": {
    "branch": "feat/migration",
    "sha": "abc1234",
    "dirty": false,
    "modifiedFiles": ["src/a.ts", "src/b.ts", "src/c.ts"]
  },
  "todos": {
    "completed": ["task-1", "task-2", "task-3"],
    "remaining": ["task-4", "task-5", "task-6"],
    "blocked": [],
    "inProgress": "task-4"
  },
  "verification": {
    "compile": "pass",
    "lint": "pass",
    "test": "pass",
    "testCount": "12/12"
  },
  "notes": "Next: migrate remaining 3 components. Task-4 is partially started."
}
```

## Usage

```bash
# Save a checkpoint with description
/checkpoint save "Completed phase 3 migration"

# List all checkpoints for current project
/checkpoint list

# Show details of a specific checkpoint
/checkpoint show <checkpoint-id>

# Restore from latest checkpoint
/checkpoint restore

# Restore from specific checkpoint
/checkpoint restore <checkpoint-id>

# Clean old checkpoints (keep last 10)
/checkpoint clean
```

## Auto-Checkpoint Thresholds

| Context Used | Action |
|-------------|--------|
| **70%** | Save checkpoint, log progress summary |
| **80%** | Save checkpoint, commit all completed work to git |
| **90%** | STOP work. Save checkpoint, write handoff notes, prepare for new session |

At 90%, the agent must:
1. Commit all completed work
2. Save checkpoint with detailed notes
3. List remaining tasks clearly
4. Stop accepting new work

## Integration with Todos

Checkpoints capture the full todo state:
- Which todos are completed, remaining, blocked, in-progress
- Dependencies between remaining todos
- Priority ordering for resume

On restore, todos are rebuilt from checkpoint state.

## Integration with Git

- Checkpoints record the current branch, SHA, and dirty state
- On restore, verify the git state matches (warn if diverged)
- Auto-checkpoint at 80% includes a git commit

## Storage Location

```
~/.claude/checkpoints/
  <project-name>/
    chk-20240115-103000.json
    chk-20240115-143000.json
    latest -> chk-20240115-143000.json  (symlink)
```

## Checkpoint vs Handoff

| Feature | Checkpoint | Handoff |
|---------|-----------|---------|
| **Purpose** | Pause/resume within a task | Transfer between sessions |
| **Scope** | Single task state | Full session context |
| **Storage** | `~/.claude/checkpoints/` | `~/.claude/handoffs/` |
| **Auto-triggered** | Yes (context thresholds) | No (manual only) |
| **Git state** | Records SHA + dirty | Records full diff |
| **Todo state** | Full todo snapshot | Summary only |
| **Use case** | Long task, context exhaustion | End of day, team handoff |

Checkpoints are lightweight and frequent. Handoffs are comprehensive and intentional.
