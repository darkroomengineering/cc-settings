#!/usr/bin/env bash
# Display TLDR token savings summary

STATS_FILE="${HOME}/.claude/tldr-session-stats.json"

if [ ! -f "$STATS_FILE" ]; then
    exit 0
fi

# Extract a numeric JSON value with jq fallback to grep
json_num() { jq -r ".$1 // 0" "$2" 2>/dev/null || grep -o "\"$1\":[0-9]*" "$2" 2>/dev/null | grep -o '[0-9]*'; }

CALLS=$(json_num calls "$STATS_FILE")
TOKENS_SAVED=$(json_num tokens_saved "$STATS_FILE")

CALLS=${CALLS:-0}
TOKENS_SAVED=${TOKENS_SAVED:-0}

if [ "$CALLS" -gt 0 ]; then
    echo ""
    echo "┌─────────────────────────────────────────┐"
    echo "│ 📊 TLDR Session Stats                   │"
    echo "├─────────────────────────────────────────┤"
    printf "│ %-39s │\n" "Calls: $CALLS"
    printf "│ %-39s │\n" "Est. tokens saved: ~${TOKENS_SAVED}"
    echo "└─────────────────────────────────────────┘"
fi

# Reset stats for next session
rm -f "$STATS_FILE"
