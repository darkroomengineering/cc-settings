---
name: checkpoint
description: "Save and restore task state for long-running operations. Use when user says 'checkpoint', 'save state', 'save progress', 'restore checkpoint', or 'list checkpoints'. Also use when context window is running low and state needs persisting, or before risky operations that might need rollback."
context: fork
allowed-tools: "Bash"
---

# Checkpoint: Save & Restore Task State

Manage checkpoints for long-running tasks via `~/.claude/scripts/checkpoint.sh`. Checkpoints are stored at `~/.claude/checkpoints/<project-name>/` as JSON files with a `latest` symlink.

## Subcommands

### save [label]

```bash
~/.claude/scripts/checkpoint.sh save "Completed phase 3 migration"
```

### list

```bash
~/.claude/scripts/checkpoint.sh list
```

### show [checkpoint-id]

```bash
~/.claude/scripts/checkpoint.sh show chk-20240115-103000
```

### restore [checkpoint-id]

```bash
# Restore latest
~/.claude/scripts/checkpoint.sh restore

# Restore specific
~/.claude/scripts/checkpoint.sh restore chk-20240115-103000
```

### clean

Remove old checkpoints, keeping the last 10.

```bash
~/.claude/scripts/checkpoint.sh clean
```

## Workflow

1. **Save** before risky operations: `checkpoint.sh save "Before auth refactor"`
2. **List** to review available restore points: `checkpoint.sh list`
3. **Restore** if something goes wrong: `checkpoint.sh restore`
4. **Clean** periodically to remove stale checkpoints: `checkpoint.sh clean`
