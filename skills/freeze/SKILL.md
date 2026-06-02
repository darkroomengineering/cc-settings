---
name: freeze
description: Lock file edits to one directory for the session — Edit/Write/MultiEdit outside it are blocked, not just warned. Use when debugging to stop accidental edits to unrelated code, or to fence a parallel agent to one module. Triggers "freeze edits", "lock editing scope", "restrict edits to", "only edit this folder", "unfreeze", "lift the freeze".
context: main
allowed-tools: [Bash, AskUserQuestion]
---

# Freeze: Lock Edits to a Directory

Restrict `Edit`, `Write`, and `MultiEdit` to a single directory. Any edit targeting a file outside the boundary is **blocked** by the `freeze-guard` PreToolUse hook. State persists for the session in `~/.claude/tmp/freeze.json`.

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
