#!/usr/bin/env bash
# PermissionDenied hook — fires after auto mode denies a tool call
#
# Logs denied actions for review. Helps identify permissions that
# should be added to the allow list.

input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // "unknown"' 2>/dev/null)
timestamp=$(date '+%Y-%m-%d %H:%M:%S')

# Log for later review
LOG_FILE="$HOME/.claude/permission-denials.log"
echo "[$timestamp] tool=$tool_name" >> "$LOG_FILE"

echo "[PermissionDenied] Auto mode denied: $tool_name — check /permissions → Recent tab to retry"
