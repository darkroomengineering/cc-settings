# Native Hooks System

Claude Code has a **native hooks system** that executes shell scripts at specific events. These are configured in `settings.json`.

## Configured Hooks

| Event | Trigger | Script |
|-------|---------|--------|
| `UserPromptSubmit` | Before Claude sees prompt | `skill-activation.sh` (skill matching) |
| `SessionStart` | New session begins | `session-start.sh` (recalls learnings) |
| `PreToolUse` | Before Bash commands | Logs to `~/.claude/hooks.log` |
| `PostToolUse` | After Write/Edit | `post-edit.sh` (auto-format with Biome) |
| `PreCompact` | Before context compaction | `create-handoff.sh` (saves state) |
| `SessionEnd` | Session ending | `create-handoff.sh` (saves state) |
| `Notification` | Task completion | `notify.sh` (macOS/Linux notification) |

## Hook Configuration Format

Hooks are defined in `settings.json`:

```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "ToolPattern",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/scripts/your-script.sh"
          }
        ]
      }
    ]
  }
}
```

## Available Hook Events

| Event | When |
|-------|------|
| `PreToolUse` | Before any tool runs |
| `PostToolUse` | After any tool runs |
| `PermissionRequest` | When permission needed |
| `Notification` | When Claude sends notification |
| `UserPromptSubmit` | When you submit a prompt |
| `Stop` | When Claude stops |
| `SubagentStop` | When subagent stops |
| `PreCompact` | Before context compaction |
| `SessionStart` | When session begins |
| `SessionEnd` | When session ends |

## Matcher Patterns

Use `matcher` to filter which tools trigger the hook:

```json
{
  "PostToolUse": [
    {
      "matcher": "Write|Edit",
      "hooks": [...]
    }
  ]
}
```

Common patterns:
- `Write` - File writes
- `Edit` - File edits
- `Write|Edit` - Either writes or edits
- `Bash` - Shell commands

## Adding Custom Hooks

1. Create your script in `~/.claude/scripts/`:

```bash
#!/bin/bash
# my-hook.sh
echo "[Hook] Custom action" >> ~/.claude/hooks.log
```

2. Make it executable:

```bash
chmod +x ~/.claude/scripts/my-hook.sh
```

3. Add to `settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/scripts/my-hook.sh"
          }
        ]
      }
    ]
  }
}
```

## Debugging

Check hook logs:

```bash
cat ~/.claude/hooks.log
cat ~/.claude/sessions.log
```

Check skill activation output:

```bash
cat ~/.claude/skill-activation.out
```

---

## Behavioral Hook Guidelines

The markdown files in this folder (`auto-format.md`, `lint-on-save.md`, etc.) describe **behavioral guidelines** that Claude follows as part of its coding standards. These are instructions in `CLAUDE.md`, not native hooks.

| File | Description |
|------|-------------|
| `auto-format.md` | Format files after editing |
| `lint-on-save.md` | Run linter after file changes |
| `pre-commit-check.md` | Validate before git commits |
| `context-window-monitor.md` | Warn at context thresholds |
| `session-recovery.md` | Auto-recover from crashes |
| `dependency-check.md` | Validate imports exist |
| `type-check.md` | Run TypeScript on changes |
| `test-watcher.md` | Run related tests on change |
| `file-backup.md` | Create backups before edits |
| `todo-continuation-enforcer.md` | Ensure todos are completed |
| `secret-scan.md` | Scan for leaked secrets |
