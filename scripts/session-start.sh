#!/bin/bash
# Session Start Hook
# Runs when a new Claude Code session begins

echo "$(date '+%Y-%m-%d %H:%M:%S') - Session started in $(pwd)" >> ~/.claude/sessions.log

PROJECT_NAME=$(basename "$(pwd)")
LEARNINGS_BASE="${HOME}/.claude/learnings"
LEARNINGS_FILE="${LEARNINGS_BASE}/${PROJECT_NAME}/learnings.json"

if [ -f "$LEARNINGS_FILE" ] && command -v jq &> /dev/null; then
    PROJECT_LEARNINGS=$(jq '.learnings | length' "$LEARNINGS_FILE" 2>/dev/null)
    TOTAL_PROJECTS=$(find "$LEARNINGS_BASE" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
    
    if [ "$PROJECT_LEARNINGS" -gt 0 ] 2>/dev/null; then
        echo ""
        echo "🧠 MEMORY SYSTEM ACTIVE"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "📂 Project: $PROJECT_NAME"
        echo "📚 Learnings: $PROJECT_LEARNINGS for this project ($TOTAL_PROJECTS projects tracked)"
        echo ""
        echo "Recent learnings:"
        jq -r '
            .learnings | .[-3:] | .[] |
            "  • [\(.category)] \(.learning)"
        ' "$LEARNINGS_FILE" 2>/dev/null
        echo ""
        echo "💡 Run: recall-learnings.sh all"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    fi
fi
