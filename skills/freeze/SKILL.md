---
name: freeze
argument-hint: "[set|off|status] [dir]"
description: Block Edit/Write outside one session directory to contain debugging or parallel agents. Triggers "freeze edits", "lock editing scope", "restrict edits to", "only edit this folder", "unfreeze".
context: main
allowed-tools: [Bash, AskUserQuestion]
---

# Freeze: Lock Edits to a Directory

## Standalone Codex: unsupported

Stop here in standalone Codex. The plugin does not install a freeze guard for
`apply_patch`, so this skill cannot enforce an edit boundary. Do not write
freeze state or claim a directory is locked. Tell the user the operation is
unsupported and use explicit file ownership as a convention only if they want
to continue without enforcement.

The remaining workflow is Claude-only.

Restrict `Edit` and `Write` to a single directory. Any edit targeting a file outside the boundary is **blocked** by the `freeze-guard` PreToolUse hook. State persists in `~/.claude/tmp/freeze.json`, tagged with the session that set it — a freeze forgotten from a different session or project self-heals away automatically instead of blocking the next session's edits.

Note: notebook edits (`NotebookEdit`) and shell writes (`Bash`) are not gated — the boundary covers the file-editing tools only.

## Set the boundary

If the user named a directory, use it. Otherwise ask which directory to lock to (AskUserQuestion, free-text path). Then run, substituting the chosen path for PATH:

```bash
bun ~/.claude/src/scripts/freeze.ts set "PATH"
```

Confirm to the user that edits are now restricted to that path, and that they can lift it any time with "unfreeze".

## Lift the boundary

```bash
bun ~/.claude/src/scripts/freeze.ts off
```

## Check current state

```bash
bun ~/.claude/src/scripts/freeze.ts status
```
