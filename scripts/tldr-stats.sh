#!/bin/bash
# Display TLDR token savings summary

STATS_FILE="${HOME}/.claude/tldr-session-stats.json"

if [ ! -f "$STATS_FILE" ]; then
    exit 0
fi

CALLS=$(jq -r '.calls // 0' "$STATS_FILE" 2>/dev/null)
TOKENS_SAVED=$(jq -r '.tokens_saved // 0' "$STATS_FILE" 2>/dev/null)

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
