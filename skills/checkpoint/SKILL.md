---
name: checkpoint
argument-hint: "[save|restore|show|list|clean] [name-or-id]"
description: Save or restore a mid-task rollback point before a risky refactor, migration, or destructive edit. Triggers "checkpoint", "snapshot", "rollback to", "list checkpoints". End-of-session saves go to /handoff.
context: fork
allowed-tools: [Bash]
---

# Checkpoint: Save & Restore Task State

## Product-aware runner

Set these once for the active host. `checkpoint.ts` uses `claudePath`, so pass
the matching state root on every invocation.

```bash
# Standalone Codex
CHECKPOINT_RUNNER="${CODEX_HOME:-$HOME/.codex}/darkroom/source/src/scripts/checkpoint.ts"
CC_STATE_ROOT="${CODEX_HOME:-$HOME/.codex}/darkroom/state"

# Claude Code instead uses:
# CHECKPOINT_RUNNER="$HOME/.claude/src/scripts/checkpoint.ts"
# CC_STATE_ROOT="$HOME/.claude"
```

## Subcommands

### save [label]

Save current state with an optional label.

```bash
CC_SETTINGS_HOME="$CC_STATE_ROOT" bun "$CHECKPOINT_RUNNER" save "Completed phase 3 migration"
```

### list

List all checkpoints for the current project.

```bash
CC_SETTINGS_HOME="$CC_STATE_ROOT" bun "$CHECKPOINT_RUNNER" list
```

### show [checkpoint-id]

Show details of a specific checkpoint.

```bash
CC_SETTINGS_HOME="$CC_STATE_ROOT" bun "$CHECKPOINT_RUNNER" show chk-20240115-103000
```

### restore [checkpoint-id] [--force]

Real, opt-in rollback — restores tracked files (working tree + index) to
exactly what they were at save time, then reapplies whatever uncommitted
changes existed at that moment (captured as a binary-complete patch when the checkpoint was
saved). Untracked content is not captured; files untracked at save time are
listed as a warning. A forced restore across commits can overwrite a currently
untracked path that was tracked in the saved commit. Move that content outside
the repository before using `--force`; the safety checkpoint cannot recover it.
Scope note: restore reconstructs file *content* only — anything that was
staged at save time comes back as unstaged working-tree changes (the patch
reapplies to the worktree; index state is intentionally not reconstructed).

Safety rails:
- **Validate before reset.** The saved commit and patch are checked against a
  temporary Git index before tracked files are changed. A missing, unreadable,
  or non-restorable patch (including an old text-only binary diff) refuses
  restoration without resetting the working tree.
- **Auto safety-checkpoint first.** Before anything is touched, the current
  state is saved as its own checkpoint and its id is printed —
  tracked content is recoverable by restoring that id (with `--force`).
  This safety checkpoint also excludes untracked content.
- **Branch/sha guard.** If the current branch or HEAD differs from what the
  checkpoint recorded, restore refuses and tells you to check out that branch
  or pass `--force`.
- **Legacy checkpoints** (saved before this patch-capture feature existed)
  have no recorded diff to restore from. Restoring one prints "legacy
  checkpoint: metadata only, nothing restored" and falls back to the old
  print-only behavior — review the dumped JSON and continue manually.

```bash
# Restore latest
CC_SETTINGS_HOME="$CC_STATE_ROOT" bun "$CHECKPOINT_RUNNER" restore

# Restore specific
CC_SETTINGS_HOME="$CC_STATE_ROOT" bun "$CHECKPOINT_RUNNER" restore chk-20240115-103000

# Restore across a branch/sha mismatch
CC_SETTINGS_HOME="$CC_STATE_ROOT" bun "$CHECKPOINT_RUNNER" restore chk-20240115-103000 --force
```

### clean

Remove old checkpoints, keeping the last 10.

```bash
CC_SETTINGS_HOME="$CC_STATE_ROOT" bun "$CHECKPOINT_RUNNER" clean
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

Checkpoints are stored under `$CC_STATE_ROOT/checkpoints/<project-name>/` as
JSON files with a `latest` symlink pointing to the most recent. Each checkpoint
with uncommitted changes at save time also gets a sibling `chk-<id>.patch` file
(`git diff --binary --full-index HEAD` output) — this is what makes `restore` a real rollback instead
of a metadata dump. Checkpoints saved before this feature existed have no patch
metadata and restore in metadata-only (legacy) mode. A checkpoint that declares
a patch but has lost that file is an error, not a metadata-only checkpoint.
