# Native Hooks System

Claude Code has a **native hooks system** that executes shell scripts at specific events. These are configured in `settings.json`.

All hooks are **automatically installed** by the setup script. No manual configuration needed.

## Configured Hooks

| Event | Trigger | Script | Async |
|-------|---------|--------|-------|
| `UserPromptSubmit` | Before Claude sees prompt | `skill-activation.sh` (skill matching) | No |
| `UserPromptSubmit` | On user correction | Correction detection (learning reminder) | No |
| `SessionStart` | New session begins | `session-start.sh` (recalls learnings, auto-warms TLDR) | No |
| `PreToolUse` | Before Bash commands (Bash matcher) | `safety-net.sh` (blocks destructive commands) | No |
| `PreToolUse` | Before git commit (Bash matcher) | Pre-commit tsc check (TypeScript validation) | No |
| `PreToolUse` | Before package install (Bash matcher) | `check-docs-before-install.sh` (doc-fetch reminder) | No |
| `PreToolUse` | Before Edit calls (Edit matcher) | `pre-edit-validate.sh` (harness optimization) | No |
| `PostToolUse` | After Write/Edit | `post-edit.sh` (auto-format with Biome) | No |
| `PostToolUse` | After Edit | Async tsc check (TypeScript type errors) | **Yes** |
| `PostToolUse` | After TLDR MCP calls | `track-tldr.sh` (usage stats) | **Yes** |
| `PreCompact` | Before context compaction | `handoff.sh create` (saves state) | No |
| `SessionEnd` | Session ending | `tldr-stats.sh` + `handoff.sh create` | **Yes** |
| `Stop` | Claude finishes | Learning reminder if >5 files changed | No |
| `SubagentStart` | Subagent spawns | Logs to `~/.claude/swarm.log` | **Yes** |
| `SubagentStop` | Subagent finishes | Logs to `~/.claude/swarm.log` | **Yes** |
| `Notification` | Task completion | `notify.sh` (macOS/Linux notification) | **Yes** |

## Correction Detection Hook

When you correct Claude with phrases like "no," "wrong," "actually," "instead," or "fix that," a hook automatically reminds Claude to capture the learning:

```
[Hook] Correction detected - consider capturing this as a learning with /learn
```

This ensures mistakes become permanent knowledge across sessions.

## Supporting Scripts

These scripts are used by commands or other hooks but aren't directly triggered by events:

| Script | Purpose |
|--------|---------|
| `statusline.sh` | Generates custom status bar (model, git, context %) |
| `handoff.sh resume` | Loads previous session state |
| `learning.sh recall` | Retrieves stored learnings by category/search |
| `learning.sh store` | Persists a new learning with category |
| `learning.sh delete` | Removes outdated learnings |

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
            "command": "~/.claude/scripts/your-script.sh",
            "async": true,
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### Hook Options

| Option | Type | Description |
|--------|------|-------------|
| `type` | string | `"command"`, `"prompt"` (LLM yes/no), or `"agent"` (subagent with tools) |
| `command` | string | Shell command to execute (for `command` type) |
| `async` | boolean | Run in background without blocking |
| `timeout` | number | Timeout in seconds (default: 600, max: 600) |
| `once` | boolean | Run exactly once per session then disable (skills only) |

### Async Hooks (Background Execution)

Use `async: true` for hooks that don't need to block execution:

```json
{
  "PostToolUse": [
    {
      "matcher": "mcp__tldr",
      "hooks": [
        {
          "type": "command",
          "command": "~/.claude/scripts/track-tldr.sh",
          "async": true,
          "timeout": 10
        }
      ]
    }
  ]
}
```

**Best uses for async hooks:**
- Logging and metrics collection
- Notifications (desktop alerts)
- Non-critical tracking (TLDR usage stats)
- Session cleanup tasks

**Avoid async for:**
- Validation hooks (PreToolUse)
- Hooks that need to block/allow operations
- Hooks that inject context (UserPromptSubmit, SessionStart)

## Available Hook Events (14 total)

| Event | When | Matcher |
|-------|------|---------|
| `SessionStart` | When session begins | `startup`, `resume`, `clear`, `compact` |
| `UserPromptSubmit` | When you submit a prompt | - |
| `PreToolUse` | Before any tool runs | Tool name |
| `PermissionRequest` | When permission needed | Tool name |
| `PostToolUse` | After any tool runs | Tool name |
| `PostToolUseFailure` | After a tool fails | Tool name |
| `Notification` | When Claude sends notification | Notification type |
| `SubagentStart` | When subagent spawns | Agent type |
| `SubagentStop` | When subagent finishes | Agent type |
| `Stop` | When Claude stops | - |
| `TeammateIdle` | When agent team teammate goes idle | - |
| `TaskCompleted` | When a task is marked completed | - |
| `PreCompact` | Before context compaction | `manual` or `auto` |
| `SessionEnd` | When session ends | - |

### Hook Types

| Type | Description |
|------|-------------|
| `command` | Shell command (standard) |
| `prompt` | LLM single-turn yes/no evaluation |
| `agent` | Subagent with tools (Read, Grep, Glob) for verification |

## Swarm/Multi-Agent Hooks

The `SubagentStart` and `SubagentStop` hooks enable monitoring and coordination of parallel agents (swarm pattern).

### Configuration

```json
{
  "SubagentStart": [
    {
      "matcher": "explore",
      "hooks": [
        {
          "type": "command",
          "command": "echo \"Explore agent started\" >> ~/.claude/swarm.log",
          "async": true
        }
      ]
    }
  ],
  "SubagentStop": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "bash -c 'echo \"[Swarm] Agent stopped: $AGENT_TYPE ($AGENT_ID)\" >> ~/.claude/swarm.log'",
          "async": true,
          "timeout": 5
        }
      ]
    }
  ]
}
```

### Available Matchers for Subagent Hooks

| Matcher | Description |
|---------|-------------|
| `Explore` | Built-in exploration agent (Haiku) |
| `Plan` | Built-in planning agent |
| `general-purpose` | Built-in multi-step agent |
| `Bash` | Shell command subagent |
| `<custom>` | Your custom agent names |

### Environment Variables in Subagent Hooks

| Variable | Description |
|----------|-------------|
| `$AGENT_ID` | Unique identifier for the subagent |
| `$AGENT_TYPE` | Agent type (e.g., "explore", "planner") |

### Swarm Log

Monitor agent activity:

```bash
tail -f ~/.claude/swarm.log
```

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

```bash
# Hook execution logs
cat ~/.claude/hooks.log

# Swarm/agent activity log
tail -f ~/.claude/swarm.log

# Session logs
cat ~/.claude/sessions.log

# Skill activation output
cat ~/.claude/skill-activation.out

# Context usage
cat ~/.claude/context-usage.json

# TLDR session stats
cat ~/.claude/tldr-session-stats.json

# List handoffs
ls ~/.claude/handoffs/*.md

# TLDR project index
ls -la .tldr/cache/

# Subagent transcripts
ls ~/.claude/projects/*/subagents/
```

---

## Behavioral Hook Guidelines

The markdown files in this folder (`auto-format.md`, `lint-on-save.md`, etc.) describe **behavioral guidelines** that Claude follows as part of its coding standards. These are instructions in `CLAUDE.md`, not native hooks.

| File | Description |
|------|-------------|
| `auto-format.md` | Format files after editing (implemented in `post-edit.sh`) |
| `lint-on-save.md` | Run linter after file changes |
| `pre-commit-check.md` | Validate before git commits (tsc check automated; rest are guidelines) |
| `context-window-monitor.md` | Warn at context thresholds (integrated in statusline/skill-activation) |
| `session-recovery.md` | Auto-recover from crashes (partially via `session-start.sh`) |
| `dependency-check.md` | Validate imports exist |
| `type-check.md` | Run TypeScript on changes |
| `test-watcher.md` | Run related tests on change |
| `file-backup.md` | Create backups before edits |
| `todo-continuation-enforcer.md` | Ensure todos are completed |
| `secret-scan.md` | Scan for leaked secrets |
