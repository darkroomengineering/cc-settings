---
name: effort
description: "Dynamic effort level management for Claude's adaptive thinking depth. Use when user says 'think harder', 'be thorough', 'quick fix', 'max effort', 'slow down', 'speed up', or 'think more'. Also use when task complexity changes mid-session and speed vs depth tradeoff is needed."
allowed-tools: "Bash"
argument-hint: "[low|medium|high]"
---

# Effort Level Management

Adjust Claude's adaptive thinking depth based on task complexity via `CLAUDE_CODE_EFFORT_LEVEL`.

## Effort Levels

| Level | When to Use | Thinking Behavior |
|-------|-------------|-------------------|
| `low` | Simple edits, formatting, renaming, boilerplate | Minimal — fast responses |
| `medium` | File exploration, standard queries | Balanced depth |
| `high` | Complex logic, architecture, security reviews, hard bugs (DEFAULT) | Deep analysis, maximum depth |

## Setting Effort

- **Environment variable**: `CLAUDE_CODE_EFFORT_LEVEL`
- **Interactive**: `/model` then use arrow keys to adjust
- **Check current**: `echo $CLAUDE_CODE_EFFORT_LEVEL`

## Workflow

1. Parse the user's argument (`low`, `medium`, or `high`) or infer from context (e.g., "think harder" → `high`, "quick fix" → `low`)
2. Acknowledge the level change
3. Explain what the new level means for the current session's response depth
