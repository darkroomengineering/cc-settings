#!/bin/bash
# Store Learning Script
# Saves learnings to per-project JSON storage for cross-session memory

PROJECT_DIR=$(pwd)
PROJECT_NAME=$(basename "$PROJECT_DIR")
LEARNINGS_BASE="${HOME}/.claude/learnings"
LEARNINGS_DIR="${LEARNINGS_BASE}/${PROJECT_NAME}"
LEARNINGS_FILE="${LEARNINGS_DIR}/learnings.json"

mkdir -p "$LEARNINGS_DIR"

if [ ! -f "$LEARNINGS_FILE" ]; then
    echo '{"project":"'"$PROJECT_NAME"'","path":"'"$PROJECT_DIR"'","learnings":[]}' > "$LEARNINGS_FILE"
fi

CATEGORY="$1"
LEARNING="$2"
CONTEXT="$3"

if [ -z "$CATEGORY" ] || [ -z "$LEARNING" ]; then
    echo ""
    echo "📚 STORE LEARNING"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Usage: store-learning.sh <category> <learning> [context]"
    echo ""
    echo "Categories:"
    echo "  bug      - Bug fixes and debugging insights"
    echo "  pattern  - Code patterns that work well"
    echo "  gotcha   - Gotchas and edge cases"
    echo "  tool     - Tool/library usage tips"
    echo "  perf     - Performance optimizations"
    echo "  config   - Configuration discoveries"
    echo "  arch     - Architecture decisions"
    echo "  test     - Testing insights"
    echo ""
    echo "Examples:"
    echo "  store-learning.sh bug 'useAuth causes hydration error - use dynamic import'"
    echo "  store-learning.sh pattern 'Wrap async server components in Suspense' 'app/page.tsx'"
    echo "  store-learning.sh gotcha 'Biome ignores .mdx files by default'"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ID=$(date +%s%N | sha256sum | head -c 8)
GIT_BRANCH=""
if git rev-parse --git-dir > /dev/null 2>&1; then
    GIT_BRANCH=$(git branch --show-current 2>/dev/null)
fi

LEARNING_ESCAPED=$(echo "$LEARNING" | sed 's/"/\\"/g' | sed 's/\\/\\\\/g')
CONTEXT_ESCAPED=$(echo "$CONTEXT" | sed 's/"/\\"/g' | sed 's/\\/\\\\/g')

NEW_LEARNING=$(cat <<EOF
{
  "id": "$ID",
  "timestamp": "$TIMESTAMP",
  "category": "$CATEGORY",
  "learning": "$LEARNING_ESCAPED",
  "context": "$CONTEXT_ESCAPED",
  "branch": "$GIT_BRANCH"
}
EOF
)

TEMP_FILE=$(mktemp)
if command -v jq &> /dev/null; then
    jq --argjson new "$NEW_LEARNING" '.learnings += [$new]' "$LEARNINGS_FILE" > "$TEMP_FILE"
    mv "$TEMP_FILE" "$LEARNINGS_FILE"
else
    EXISTING=$(cat "$LEARNINGS_FILE")
    if [ "$EXISTING" = '{"learnings":[]}' ]; then
        echo "{\"learnings\":[$NEW_LEARNING]}" > "$LEARNINGS_FILE"
    else
        sed -i.bak 's/\]}$/,'"$(echo "$NEW_LEARNING" | tr -d '\n')"']}/' "$LEARNINGS_FILE"
        rm -f "${LEARNINGS_FILE}.bak"
    fi
fi

echo ""
echo "✅ LEARNING STORED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📁 ID: $ID"
echo "📂 Category: $CATEGORY"
echo "📝 Learning: $LEARNING"
if [ -n "$CONTEXT" ]; then
    echo "📍 Context: $CONTEXT"
fi
echo "🏷️  Project: $PROJECT_NAME"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit 0
