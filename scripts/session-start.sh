#!/bin/bash
# Session Start Hook
# Runs when a new Claude Code session begins
# - Rotates logs
# - Cleans old handoffs
# - Auto-warms tldr index (background)
# - Recalls project learnings

CLAUDE_DIR="${HOME}/.claude"
PROJECT_DIR="$(pwd)"
PROJECT_NAME=$(basename "$PROJECT_DIR")

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

echo "$(date '+%Y-%m-%d %H:%M:%S') - Session started in $PROJECT_DIR" >> "${CLAUDE_DIR}/sessions.log"

# Pre-warm jq and skill-rules.json into filesystem cache (background, non-blocking)
SKILLS_FILE="${CLAUDE_DIR}/skills/skill-rules.json"
if [ -f "$SKILLS_FILE" ] && command -v jq &>/dev/null; then
    jq empty "$SKILLS_FILE" 2>/dev/null &
fi

# Auto-warm tldr index if available and not already warmed
# Runs in background, non-blocking
auto_warm_tldr() {
    # Check if tldr is installed
    if ! command -v tldr &>/dev/null; then
        return 0
    fi

    # Check if this is a code project (has common project markers)
    if [ ! -f "$PROJECT_DIR/package.json" ] && \
       [ ! -f "$PROJECT_DIR/Cargo.toml" ] && \
       [ ! -f "$PROJECT_DIR/go.mod" ] && \
       [ ! -f "$PROJECT_DIR/pyproject.toml" ] && \
       [ ! -f "$PROJECT_DIR/setup.py" ] && \
       [ ! -f "$PROJECT_DIR/Makefile" ] && \
       [ ! -d "$PROJECT_DIR/.git" ]; then
        return 0
    fi

    # Check if already warmed (look for .tldr directory or cache)
    TLDR_CACHE="${CLAUDE_DIR}/tldr-cache/${PROJECT_NAME}.warmed"
    TLDR_INDEX="$PROJECT_DIR/.tldr"

    if [ -d "$TLDR_INDEX" ]; then
        # Already has a tldr index
        return 0
    fi

    # Check if we've tried warming recently (within last hour) to avoid repeated attempts
    if [ -f "$TLDR_CACHE" ]; then
        CACHE_AGE=$(($(date +%s) - $(stat -f%m "$TLDR_CACHE" 2>/dev/null || stat -c%Y "$TLDR_CACHE" 2>/dev/null || echo 0)))
        if [ "$CACHE_AGE" -lt 3600 ]; then
            return 0
        fi
    fi

    # Determine language flag based on project type
    LANG_FLAG=""
    if [ -f "$PROJECT_DIR/tsconfig.json" ] || [ -f "$PROJECT_DIR/package.json" ]; then
        LANG_FLAG="--lang typescript"
    elif [ -f "$PROJECT_DIR/Cargo.toml" ]; then
        LANG_FLAG="--lang rust"
    elif [ -f "$PROJECT_DIR/go.mod" ]; then
        LANG_FLAG="--lang go"
    elif [ -f "$PROJECT_DIR/pyproject.toml" ] || [ -f "$PROJECT_DIR/setup.py" ]; then
        LANG_FLAG="--lang python"
    fi

    # Create cache directory
    mkdir -p "${CLAUDE_DIR}/tldr-cache"

    # Mark that we're attempting to warm (prevents repeated attempts)
    touch "$TLDR_CACHE"

    # Run tldr warm in background (completely non-blocking)
    (
        cd "$PROJECT_DIR" && \
        tldr warm . $LANG_FLAG >/dev/null 2>&1 && \
        echo "$(date '+%Y-%m-%d %H:%M:%S') - TLDR warmed: $PROJECT_NAME" >> "${CLAUDE_DIR}/sessions.log"
    ) &
    disown
}

# Run tldr auto-warm in background
auto_warm_tldr &
disown

# Display learnings if available
LEARNINGS_BASE="${CLAUDE_DIR}/learnings"
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

# Show tldr status if installed
if command -v tldr &>/dev/null; then
    if [ -d "$PROJECT_DIR/.tldr" ]; then
        echo ""
        echo "🔍 TLDR index available for semantic search"
    else
        echo ""
        echo "🔍 TLDR warming in background (semantic search coming soon)"
    fi
fi
