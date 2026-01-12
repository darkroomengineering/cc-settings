#!/bin/bash
# Delete Learning Script
# Removes a learning by ID from per-project storage

PROJECT_NAME=$(basename "$(pwd)")
LEARNINGS_BASE="${HOME}/.claude/learnings"
LEARNINGS_DIR="${LEARNINGS_BASE}/${PROJECT_NAME}"
LEARNINGS_FILE="${LEARNINGS_DIR}/learnings.json"

LEARNING_ID="$1"

if [ -z "$LEARNING_ID" ]; then
    echo ""
    echo "🗑️  DELETE LEARNING"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Usage: delete-learning.sh <learning_id>"
    echo ""
    echo "Find learning IDs with: recall-learnings.sh all"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

if [ ! -f "$LEARNINGS_FILE" ]; then
    echo "No learnings file found."
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required for delete. Install with: brew install jq"
    exit 1
fi

LEARNING=$(jq --arg id "$LEARNING_ID" '.learnings[] | select(.id == $id)' "$LEARNINGS_FILE")

if [ -z "$LEARNING" ]; then
    echo ""
    echo "❌ LEARNING NOT FOUND"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "No learning found with ID: $LEARNING_ID"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

TEMP_FILE=$(mktemp)
jq --arg id "$LEARNING_ID" '.learnings |= map(select(.id != $id))' "$LEARNINGS_FILE" > "$TEMP_FILE"
mv "$TEMP_FILE" "$LEARNINGS_FILE"

echo ""
echo "✅ LEARNING DELETED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Removed learning: $LEARNING_ID"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit 0
