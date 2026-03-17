#!/bin/bash
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

# Read JSON from stdin
STDIN_JSON=$(cat)

# Extract command from tool_input.command in the JSON
# 1. Flatten to single line
# 2. Replace \" with placeholder (so [^"]* doesn't stop at escaped quotes)
# 3. Extract command value with non-greedy match
# 4. Restore escaped quotes, normalize newlines
CMD=$(echo "$STDIN_JSON" | tr '\n' ' ' | sed 's/\\"/\x01/g' | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | sed 's/\x01/"/g; s/\\n/ /g' | head -1)

if [ -n "$CMD" ]; then
  PROJECT=$(basename "$PWD" 2>/dev/null)
  echo "[$(date +%H:%M:%S)] [$PROJECT] $CMD" >> "$LOG_DIR/bash-$(date +%Y-%m-%d).log"
fi
