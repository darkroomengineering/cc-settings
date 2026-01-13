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

# Portable unique ID generation (works on macOS and Linux)
# macOS doesn't support date +%s%N, so use alternative method
generate_id() {
    if command -v shasum &>/dev/null; then
        echo "$$-$(date +%s)-$RANDOM" | shasum -a 256 | head -c 8
    elif command -v sha256sum &>/dev/null; then
        echo "$$-$(date +%s)-$RANDOM" | sha256sum | head -c 8
    else
        # Fallback: use base64 encoding of timestamp + random
        echo "$(date +%s)$RANDOM" | base64 | tr -dc 'a-zA-Z0-9' | head -c 8
    fi
}

ID=$(generate_id)

GIT_BRANCH=""
if git rev-parse --git-dir > /dev/null 2>&1; then
    GIT_BRANCH=$(git branch --show-current 2>/dev/null)
fi

# Escape special characters for JSON
escape_json() {
    local input="$1"
    printf '%s' "$input" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g' | tr -d '\n'
}

LEARNING_ESCAPED=$(escape_json "$LEARNING")
CONTEXT_ESCAPED=$(escape_json "$CONTEXT")

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

# Portable file update (avoids sed -i differences between macOS and Linux)
TEMP_FILE=$(mktemp)
if command -v jq &>/dev/null; then
    jq --argjson new "$NEW_LEARNING" '.learnings += [$new]' "$LEARNINGS_FILE" > "$TEMP_FILE" && mv "$TEMP_FILE" "$LEARNINGS_FILE"
else
    # Fallback without jq - portable approach
    EXISTING=$(cat "$LEARNINGS_FILE")
    if echo "$EXISTING" | grep -q '"learnings":\[\]'; then
        # Empty learnings array
        echo "${EXISTING%\]\}*}[$NEW_LEARNING]}" > "$TEMP_FILE"
    else
        # Has existing learnings - insert before closing brackets
        # Use awk for portable in-place style editing
        awk -v new="$NEW_LEARNING" '
            /\]\}$/ { gsub(/\]\}$/, "," new "]}"); }
            { print }
        ' "$LEARNINGS_FILE" > "$TEMP_FILE"
    fi
    mv "$TEMP_FILE" "$LEARNINGS_FILE"
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
