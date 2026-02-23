#!/bin/bash
# Post-Failure Hook - PostToolUseFailure event
# Logs tool failures and warns on repeated failures per session
# Fail-open: exit 0 always

CLAUDE_DIR="${HOME}/.claude"
LOG_DIR="${CLAUDE_DIR}/logs"
LOG_FILE="${LOG_DIR}/tool-failures.log"
SESSION_FILE="${CLAUDE_DIR}/tmp/tool-failure-counts"

# Ensure directories exist
mkdir -p "$LOG_DIR" "${CLAUDE_DIR}/tmp" 2>/dev/null || true

# Extract tool info from environment
TOOL_NAME="${TOOL_NAME:-unknown}"
TOOL_INPUT="${TOOL_INPUT:-}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%s")

# Truncate tool input for logging (max 200 chars)
if [[ ${#TOOL_INPUT} -gt 200 ]]; then
    TOOL_INPUT="${TOOL_INPUT:0:200}..."
fi

# Log the failure (use jq for safe JSON construction)
if command -v jq &>/dev/null; then
    jq -n --arg ts "$TIMESTAMP" --arg tool "$TOOL_NAME" --arg input "${TOOL_INPUT:0:200}" \
        '{"timestamp":$ts,"tool":$tool,"input":$input}' >> "$LOG_FILE" 2>/dev/null || true
else
    SAFE_INPUT=$(echo "${TOOL_INPUT:0:200}" | tr '\n' ' ' | sed 's/"/\\"/g')
    echo "{\"timestamp\":\"${TIMESTAMP}\",\"tool\":\"${TOOL_NAME}\",\"input\":\"${SAFE_INPUT}\"}" \
        >> "$LOG_FILE" 2>/dev/null || true
fi

# Track per-session failure counts
# Session file format: TOOL_NAME=COUNT (one per line)
CURRENT_COUNT=0
if [[ -f "$SESSION_FILE" ]]; then
    CURRENT_COUNT=$(grep -c "^${TOOL_NAME}$" "$SESSION_FILE" 2>/dev/null)
    CURRENT_COUNT=${CURRENT_COUNT:-0}
fi

# Record this failure
echo "$TOOL_NAME" >> "$SESSION_FILE" 2>/dev/null || true

# Increment count (current + this one)
NEW_COUNT=$((CURRENT_COUNT + 1))

# Warn if same tool has failed 3+ times
if [[ "$NEW_COUNT" -ge 3 ]]; then
    echo ""
    echo "[Hook] Tool $TOOL_NAME has failed $NEW_COUNT times this session. Consider a different approach."
fi

exit 0
