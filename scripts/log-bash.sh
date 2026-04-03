#!/usr/bin/env bash
# Log every Bash command Claude runs to a daily log file.
# Called as a PostToolUse hook for Bash.
# Receives JSON on stdin (not env var).
#
# Retention: set CLAUDE_LOG_RETENTION_DAYS in ~/.claude/settings.json env.
# Default: 1 (today only). Set to 7 for weekly, 30 for monthly, etc.

LOG_DIR="$HOME/.claude/logs"
mkdir -p "$LOG_DIR"

RETENTION=${CLAUDE_LOG_RETENTION_DAYS:-1}

# Prune old logs
find "$LOG_DIR" -name "bash-*.log" -mtime +"$RETENTION" -delete 2>/dev/null

# Read JSON from stdin (PostToolUse receives data on stdin, not env vars)
STDIN_JSON=$(cat)
CMD=$(echo "$STDIN_JSON" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [ -n "$CMD" ]; then
  PROJECT=$(basename "$PWD" 2>/dev/null)
  echo "[$(date +%H:%M:%S)] [$PROJECT] $CMD" >> "$LOG_DIR/bash-$(date +%Y-%m-%d).log"
fi
