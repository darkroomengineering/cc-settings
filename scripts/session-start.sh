#!/bin/bash
# Session Start Hook
# Runs when a new Claude Code session begins

CLAUDE_DIR="${HOME}/.claude"

# Log rotation - rotate logs over 1MB
for log in sessions.log edits.log hooks.log; do
    LOG_FILE="${CLAUDE_DIR}/$log"
    if [ -f "$LOG_FILE" ]; then
        SIZE=$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
        if [ "$SIZE" -gt 1048576 ]; then
            mv "$LOG_FILE" "${LOG_FILE}.old"
        fi
    fi
done

# Handoff cleanup - keep last 20
HANDOFF_DIR="${CLAUDE_DIR}/handoffs"
if [ -d "$HANDOFF_DIR" ]; then
    ls -1t "$HANDOFF_DIR"/handoff_*.json 2>/dev/null | tail -n +21 | xargs -r rm -f
    ls -1t "$HANDOFF_DIR"/handoff_*.md 2>/dev/null | tail -n +21 | xargs -r rm -f
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') - Session started in $(pwd)" >> "${CLAUDE_DIR}/sessions.log"

# Pre-warm jq and skill-rules.json into filesystem cache (background, non-blocking)
SKILLS_FILE="${CLAUDE_DIR}/skills/skill-rules.json"
if [ -f "$SKILLS_FILE" ] && command -v jq &>/dev/null; then
    jq empty "$SKILLS_FILE" 2>/dev/null &
fi

PROJECT_NAME=$(basename "$(pwd)")
LEARNINGS_BASE="${HOME}/.claude/learnings"
LEARNINGS_FILE="${LEARNINGS_BASE}/${PROJECT_NAME}/learnings.json"

if [ -f "$LEARNINGS_FILE" ] && command -v jq &>/dev/null; then
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
