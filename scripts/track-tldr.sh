#!/usr/bin/env bash
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

# Extract a numeric JSON value with jq fallback to grep
json_num() { jq -r ".$1 // 0" "$2" 2>/dev/null || grep -o "\"$1\":[0-9]*" "$2" 2>/dev/null | grep -o '[0-9]*'; }

CURRENT_CALLS=$(json_num calls "$STATS_FILE")
CURRENT_SAVED=$(json_num tokens_saved "$STATS_FILE")

CURRENT_CALLS=${CURRENT_CALLS:-0}
CURRENT_SAVED=${CURRENT_SAVED:-0}

NEW_CALLS=$((CURRENT_CALLS + 1))
NEW_SAVED=$((CURRENT_SAVED + SAVED))

TEMP_FILE=$(mktemp)
echo "{\"calls\": $NEW_CALLS, \"tokens_saved\": $NEW_SAVED}" > "$TEMP_FILE" && mv "$TEMP_FILE" "$STATS_FILE"
