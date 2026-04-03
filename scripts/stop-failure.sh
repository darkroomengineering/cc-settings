#!/usr/bin/env bash
# StopFailure hook — fires when a turn ends due to API error (rate limits, timeouts)
#
# Logs the failure for tracking and notifies the user.

input=$(cat)

error_type=$(echo "$input" | jq -r '.error.type // "unknown"' 2>/dev/null)
error_message=$(echo "$input" | jq -r '.error.message // "Unknown error"' 2>/dev/null)
timestamp=$(date '+%Y-%m-%d %H:%M:%S')

# Log to file for tracking rate limit patterns
LOG_FILE="$HOME/.claude/api-failures.log"
echo "[$timestamp] type=$error_type msg=$error_message" >> "$LOG_FILE"

# Surface to the user
if echo "$error_message" | grep -qi "rate.limit\|429\|capacity\|overloaded"; then
  echo "[StopFailure] Rate limit hit at $timestamp. Consider:"
  echo "  - Using /effort low for simple tasks"
  echo "  - Delegating more work to sonnet-based agents"
  echo "  - Waiting a few minutes before retrying"
else
  echo "[StopFailure] API error at $timestamp: $error_type"
fi
