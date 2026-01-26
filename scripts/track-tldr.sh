#!/bin/bash
# Track TLDR MCP tool usage for session stats

STATS_FILE="${HOME}/.claude/tldr-session-stats.json"
TOOL_NAME="${1:-unknown}"

if [ ! -f "$STATS_FILE" ]; then
    echo '{"calls": 0, "tokens_saved": 0}' > "$STATS_FILE"
fi

case "$TOOL_NAME" in
    *context*)
        SAVED=500
        ;;
    *semantic*)
        SAVED=1000
        ;;
    *impact*|*slice*)
        SAVED=800
        ;;
    *arch*)
        SAVED=600
        ;;
    *)
        SAVED=300
        ;;
esac

if command -v jq &>/dev/null; then
    CURRENT_CALLS=$(jq -r '.calls // 0' "$STATS_FILE" 2>/dev/null)
    CURRENT_SAVED=$(jq -r '.tokens_saved // 0' "$STATS_FILE" 2>/dev/null)
else
    CURRENT_CALLS=$(grep -o '"calls":[0-9]*' "$STATS_FILE" 2>/dev/null | grep -o '[0-9]*')
    CURRENT_SAVED=$(grep -o '"tokens_saved":[0-9]*' "$STATS_FILE" 2>/dev/null | grep -o '[0-9]*')
fi

CURRENT_CALLS=${CURRENT_CALLS:-0}
CURRENT_SAVED=${CURRENT_SAVED:-0}

NEW_CALLS=$((CURRENT_CALLS + 1))
NEW_SAVED=$((CURRENT_SAVED + SAVED))

echo "{\"calls\": $NEW_CALLS, \"tokens_saved\": $NEW_SAVED}" > "$STATS_FILE"
