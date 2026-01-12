# Hooks System (Behavioral Guidance)

> **Note**: These are behavioral guidelines defined in `CLAUDE.md`, not native Claude Code features. Claude follows these instructions as part of its system prompt.

Hooks describe automated behaviors that Claude should follow at specific points during your coding session. They help enforce best practices, maintain context awareness, and recover from errors.

## Hook Types

| Type | When It Runs |
|------|--------------|
| `pre-edit` | Before any file modification |
| `post-edit` | After file modification |
| `pre-commit` | Before git commit |
| `post-commit` | After git commit |
| `on-error` | When an error occurs |
| `on-idle` | When no activity for N seconds |
| `context-trigger` | When context threshold reached |
| `session-start` | At session initialization |
| `session-end` | Before session closes |

## Available Hooks

| Hook | Description | Default |
|------|-------------|---------|
| `todo-continuation-enforcer` | Ensures todos are completed | enabled |
| `context-window-monitor` | Warns at 70% context usage | enabled |
| `session-recovery` | Auto-recovers from crashes | enabled |
| `pre-commit-check` | Validates before commits | enabled |
| `lint-on-save` | Runs linter after edits | enabled |
| `test-watcher` | Runs related tests on change | disabled |
| `file-backup` | Creates backups before edits | disabled |
| `dependency-check` | Validates imports exist | enabled |
| `type-check` | Runs TypeScript on changes | enabled |
| `auto-format` | Formats files on save | enabled |

## Configuration

Enable/disable hooks in `settings.json`:

```json
{
  "hooks": {
    "enabled": true,
    "config": {
      "todo-continuation-enforcer": { "enabled": true },
      "context-window-monitor": { "enabled": true, "threshold": 0.7 },
      "session-recovery": { "enabled": true, "autoResume": true }
    }
  }
}
```

## Custom Hooks

Create custom hooks in `~/.claude/hooks/custom/`:

```markdown
---
name: my-hook
trigger: post-edit
pattern: "*.tsx"
---

[Hook instructions here]
```
