---
name: checkpoint
argument-hint: "[save|restore|list|clean] [name-or-id]"
description: Mid-task rollback points — save/restore state before risky ops (refactors, migrations, destructive edits). For end-of-session save use `/handoff`. Triggers "checkpoint", "snapshot", "before this risky op", "rollback to", "list checkpoints", pre-refactor save.
context: fork
allowed-tools: [Bash]
---

# Checkpoint: Save & Restore Task State

## Subcommands

### save [label]

Save current state with an optional label.

```bash
bun ~/.claude/src/scripts/checkpoint.ts save "Completed phase 3 migration"
```

### list

List all checkpoints for the current project.

```bash
bun ~/.claude/src/scripts/checkpoint.ts list
```

### show [checkpoint-id]

Show details of a specific checkpoint.

```bash
bun ~/.claude/src/scripts/checkpoint.ts show chk-20240115-103000
```

### restore [checkpoint-id] [--force]

Real, opt-in rollback — restores tracked files (working tree + index) to
exactly what they were at save time, then reapplies whatever uncommitted
changes existed at that moment (captured as a patch when the checkpoint was
saved). Untracked files are never touched or deleted; if any existed at save
time they're just listed as a warning (their content was never captured).
Scope note: restore reconstructs file *content* only — anything that was
staged at save time comes back as unstaged working-tree changes (the patch
reapplies to the worktree; index state is intentionally not reconstructed).

Safety rails:
- **Auto safety-checkpoint first.** Before anything is touched, the current
  state is saved as its own checkpoint and its id is printed — restore is
  itself reversible by restoring that id (with `--force`).
- **Branch/sha guard.** If the current branch or HEAD differs from what the
  checkpoint recorded, restore refuses and tells you to check out that branch
  or pass `--force`.
- **Legacy checkpoints** (saved before this patch-capture feature existed)
  have no recorded diff to restore from. Restoring one prints "legacy
  checkpoint: metadata only, nothing restored" and falls back to the old
  print-only behavior — review the dumped JSON and continue manually.

```bash
# Restore latest
bun ~/.claude/src/scripts/checkpoint.ts restore

# Restore specific
bun ~/.claude/src/scripts/checkpoint.ts restore chk-20240115-103000

# Restore across a branch/sha mismatch
bun ~/.claude/src/scripts/checkpoint.ts restore chk-20240115-103000 --force
```

### clean

Remove old checkpoints, keeping the last 10.

```bash
bun ~/.claude/src/scripts/checkpoint.ts clean
```

## Examples

```
User: "save a checkpoint"
  -> /checkpoint save

User: "checkpoint before this refactor"
  -> /checkpoint save "Before auth refactor"

User: "list my checkpoints"
  -> /checkpoint list

User: "restore from last checkpoint"
  -> /checkpoint restore

User: "show checkpoint details"
  -> /checkpoint show <id>

User: "clean up old checkpoints"
  -> /checkpoint clean
```

## Storage

Checkpoints are stored at `~/.claude/checkpoints/<project-name>/` as JSON files with a `latest` symlink pointing to the most recent. Each checkpoint with uncommitted changes at save time also gets a sibling `chk-<id>.patch` file (`git diff HEAD` output) — this is what makes `restore` a real rollback instead of a metadata dump. Checkpoints saved before this feature existed have no patch file and restore in metadata-only (legacy) mode.
