#!/bin/bash
# Display TLDR token savings summary

STATS_FILE="${HOME}/.claude/tldr-session-stats.json"

if [ ! -f "$STATS_FILE" ]; then
    exit 0
fi

if command -v jq &>/dev/null; then
    CALLS=$(jq -r '.calls // 0' "$STATS_FILE" 2>/dev/null)
    TOKENS_SAVED=$(jq -r '.tokens_saved // 0' "$STATS_FILE" 2>/dev/null)
else
    CALLS=$(grep -o '"calls":[0-9]*' "$STATS_FILE" 2>/dev/null | grep -o '[0-9]*')
    TOKENS_SAVED=$(grep -o '"tokens_saved":[0-9]*' "$STATS_FILE" 2>/dev/null | grep -o '[0-9]*')
fi

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
