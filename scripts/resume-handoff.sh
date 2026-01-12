#!/bin/bash
# Resume Handoff Script
# Loads previous session state for continuation

HANDOFF_DIR="${HOME}/.claude/handoffs"
HANDOFF_ID="$1"

if [ -z "$HANDOFF_ID" ]; then
    if [ -f "${HANDOFF_DIR}/latest.md" ]; then
        HANDOFF_FILE="${HANDOFF_DIR}/latest.md"
        echo ""
        echo "🔄 RESUMING LATEST SESSION"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        cat "$HANDOFF_FILE"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        exit 0
    else
        echo ""
        echo "❌ NO HANDOFF FOUND"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "No previous handoff found."
        echo ""
        echo "Available handoffs:"
        if [ -d "$HANDOFF_DIR" ]; then
            ls -la "$HANDOFF_DIR"/*.md 2>/dev/null | while read line; do
                echo "  - $(basename "$line" .md)"
            done
        else
            echo "  (none)"
        fi
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        exit 1
    fi
fi

HANDOFF_FILE="${HANDOFF_DIR}/handoff_${HANDOFF_ID}.md"

if [ ! -f "$HANDOFF_FILE" ]; then
    echo ""
    echo "❌ HANDOFF NOT FOUND"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Handoff '${HANDOFF_ID}' not found."
    echo ""
    echo "Available handoffs:"
    ls "$HANDOFF_DIR"/*.md 2>/dev/null | while read file; do
        basename "$file" .md | sed 's/handoff_//'
    done
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

echo ""
echo "🔄 RESUMING SESSION: ${HANDOFF_ID}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
cat "$HANDOFF_FILE"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Suggested Actions:"
echo "   1. Review the session summary above"
echo "   2. Continue from 'Current Task'"
echo "   3. Check off completed todos"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit 0
