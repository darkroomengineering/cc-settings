#!/bin/bash
# Unified Learning Management Script
# Manages per-project learnings for cross-session memory
#
# Subcommands:
#   store  - Save a new learning
#   recall - Query/search learnings
#   delete - Remove a learning by ID
#   list   - List all learnings (alias for recall all)

set -euo pipefail

# Common setup
PROJECT_DIR=$(pwd)
PROJECT_NAME=$(basename "$PROJECT_DIR")
LEARNINGS_BASE="${HOME}/.claude/learnings"
LEARNINGS_DIR="${LEARNINGS_BASE}/${PROJECT_NAME}"
LEARNINGS_FILE="${LEARNINGS_DIR}/learnings.json"

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

# Portable unique ID generation (works on macOS and Linux)
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

# Escape special characters for JSON
escape_json() {
    local input="$1"
    printf '%s' "$input" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g' | tr -d '\n'
}

# Format a single learning for display
format_learning() {
    local learning="$1"
    if command -v jq &> /dev/null; then
        local id=$(echo "$learning" | jq -r '.id')
        local timestamp=$(echo "$learning" | jq -r '.timestamp')
        local category=$(echo "$learning" | jq -r '.category')
        local text=$(echo "$learning" | jq -r '.learning')
        local context=$(echo "$learning" | jq -r '.context // empty')
        local branch=$(echo "$learning" | jq -r '.branch // empty')

        local date_part=$(echo "$timestamp" | cut -d'T' -f1)

        echo "  [$date_part] [$category] $text"
        if [ -n "$context" ]; then
            echo "             └─ Context: $context"
        fi
        if [ -n "$branch" ]; then
            echo "             └─ Branch: $branch (ID: $id)"
        else
            echo "             └─ ID: $id"
        fi
        echo ""
    else
        echo "$learning"
    fi
}

# Print formatted learnings
print_learnings() {
    local learnings="$1"
    local count=$(echo "$learnings" | jq 'length')

    echo ""
    echo "📚 LEARNINGS: $PROJECT_NAME"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Found $count learning(s):"
    echo ""

    echo "$learnings" | jq -c '.[]' | while read -r learning; do
        format_learning "$learning"
    done

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# ============================================================================
# STORE SUBCOMMAND
# ============================================================================

cmd_store() {
    local CATEGORY="$1"
    local LEARNING="$2"
    local CONTEXT="$3"

    if [ -z "$CATEGORY" ] || [ -z "$LEARNING" ]; then
        echo ""
        echo "📚 STORE LEARNING"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "Usage: learning.sh store <category> <learning> [context]"
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
        echo "  learning.sh store bug 'useAuth causes hydration error - use dynamic import'"
        echo "  learning.sh store pattern 'Wrap async server components in Suspense' 'app/page.tsx'"
        echo "  learning.sh store gotcha 'Biome ignores .mdx files by default'"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        exit 1
    fi

    # Ensure directory and file exist
    mkdir -p "$LEARNINGS_DIR"
    if [ ! -f "$LEARNINGS_FILE" ]; then
        jq -n \
          --arg project "$PROJECT_NAME" \
          --arg path "$PROJECT_DIR" \
          '{project: $project, path: $path, learnings: []}' \
          > "$LEARNINGS_FILE"
    fi

    local TIMESTAMP
    TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    local ID
    ID=$(generate_id)

    local GIT_BRANCH=""
    if git rev-parse --git-dir > /dev/null 2>&1; then
        GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
    fi

    # Build learning JSON safely with jq (all values properly escaped)
    local NEW_LEARNING
    NEW_LEARNING=$(jq -n \
      --arg id "$ID" \
      --arg ts "$TIMESTAMP" \
      --arg cat "$CATEGORY" \
      --arg learning "$LEARNING" \
      --arg context "$CONTEXT" \
      --arg branch "$GIT_BRANCH" \
      '{id: $id, timestamp: $ts, category: $cat, learning: $learning, context: $context, branch: $branch}')

    # Portable file update
    local TEMP_FILE
    TEMP_FILE=$(mktemp)
    jq --argjson new "$NEW_LEARNING" '.learnings += [$new]' "$LEARNINGS_FILE" > "$TEMP_FILE" && mv "$TEMP_FILE" "$LEARNINGS_FILE"

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
}

# ============================================================================
# RECALL SUBCOMMAND
# ============================================================================

show_recall_help() {
    echo ""
    echo "📚 RECALL LEARNINGS (Project: $PROJECT_NAME)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Usage: learning.sh recall [filter_type] [filter_value] [limit]"
    echo ""
    echo "Filter Types:"
    echo "  all                    - Show all learnings for current project"
    echo "  all-projects           - List all projects with learnings"
    echo "  category <cat>         - Filter by category (bug, pattern, gotcha, etc)"
    echo "  project <name>         - Switch to different project's learnings"
    echo "  search <keyword>       - Search in learning text"
    echo "  recent [n]             - Show n most recent (default 10)"
    echo ""
    echo "Examples:"
    echo "  learning.sh recall all"
    echo "  learning.sh recall all-projects"
    echo "  learning.sh recall category bug"
    echo "  learning.sh recall project other-app"
    echo "  learning.sh recall search hydration"
    echo "  learning.sh recall recent 5"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

cmd_recall() {
    local FILTER_TYPE="$1"
    local FILTER_VALUE="$2"
    local LIMIT="${3:-10}"

    # Handle all-projects first (doesn't need learnings file)
    if [ "$FILTER_TYPE" = "all-projects" ]; then
        echo ""
        echo "📚 ALL PROJECT LEARNINGS"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        for proj_dir in "$LEARNINGS_BASE"/*/; do
            if [ -d "$proj_dir" ]; then
                proj_name=$(basename "$proj_dir")
                proj_file="${proj_dir}learnings.json"
                if [ -f "$proj_file" ] && command -v jq &> /dev/null; then
                    count=$(jq '.learnings | length' "$proj_file" 2>/dev/null)
                    echo "  📂 $proj_name: $count learning(s)"
                fi
            fi
        done
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        exit 0
    fi

    # Handle project switch
    if [ "$FILTER_TYPE" = "project" ] && [ -n "$FILTER_VALUE" ]; then
        LEARNINGS_DIR="${LEARNINGS_BASE}/${FILTER_VALUE}"
        LEARNINGS_FILE="${LEARNINGS_DIR}/learnings.json"
        PROJECT_NAME="$FILTER_VALUE"
    fi

    # Check if learnings file exists
    if [ ! -f "$LEARNINGS_FILE" ]; then
        echo ""
        echo "📚 NO LEARNINGS FOR: $PROJECT_NAME"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "No learnings stored for this project."
        echo "Use 'learning.sh store' to add some."
        echo ""
        echo "Available projects with learnings:"
        for proj_dir in "$LEARNINGS_BASE"/*/; do
            if [ -d "$proj_dir" ]; then
                echo "  - $(basename "$proj_dir")"
            fi
        done
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        exit 0
    fi

    # Check for jq
    if ! command -v jq &> /dev/null; then
        echo ""
        echo "⚠️  jq not installed - showing raw JSON"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        cat "$LEARNINGS_FILE"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "Install jq for formatted output: brew install jq"
        exit 0
    fi

    case "$FILTER_TYPE" in
        ""|"help"|"-h"|"--help")
            show_recall_help
            ;;
        "all")
            RESULT=$(jq ".learnings | .[-$LIMIT:]" "$LEARNINGS_FILE")
            print_learnings "$RESULT"
            ;;
        "category"|"cat")
            if [ -z "$FILTER_VALUE" ]; then
                echo "Error: category requires a value"
                show_recall_help
                exit 1
            fi
            RESULT=$(jq --arg cat "$FILTER_VALUE" '[.learnings[] | select(.category == $cat)] | .[-'"$LIMIT"':]' "$LEARNINGS_FILE")
            print_learnings "$RESULT"
            ;;
        "project"|"proj")
            print_learnings "$(jq '.learnings | .[-'"$LIMIT"':]' "$LEARNINGS_FILE")"
            ;;
        "search"|"find"|"grep")
            if [ -z "$FILTER_VALUE" ]; then
                echo "Error: search requires a keyword"
                show_recall_help
                exit 1
            fi
            RESULT=$(jq --arg kw "$FILTER_VALUE" '[.learnings[] | select(.learning | ascii_downcase | contains($kw | ascii_downcase))] | .[-'"$LIMIT"':]' "$LEARNINGS_FILE")
            print_learnings "$RESULT"
            ;;
        "recent")
            COUNT="${FILTER_VALUE:-$LIMIT}"
            RESULT=$(jq ".learnings | .[-$COUNT:]" "$LEARNINGS_FILE")
            print_learnings "$RESULT"
            ;;
        *)
            # Default: treat as search keyword
            RESULT=$(jq --arg kw "$FILTER_TYPE" '[.learnings[] | select(.learning | ascii_downcase | contains($kw | ascii_downcase))] | .[-'"$LIMIT"':]' "$LEARNINGS_FILE")
            print_learnings "$RESULT"
            ;;
    esac

    exit 0
}

# ============================================================================
# DELETE SUBCOMMAND
# ============================================================================

cmd_delete() {
    local LEARNING_ID="$1"

    if [ -z "$LEARNING_ID" ]; then
        echo ""
        echo "🗑️  DELETE LEARNING"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "Usage: learning.sh delete <learning_id>"
        echo ""
        echo "Find learning IDs with: learning.sh recall all"
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
}

# ============================================================================
# LIST SUBCOMMAND (alias for recall all)
# ============================================================================

cmd_list() {
    cmd_recall "all" "" "${1:-10}"
}

# ============================================================================
# MAIN HELP
# ============================================================================

show_main_help() {
    echo ""
    echo "📚 LEARNING MANAGEMENT"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Usage: learning.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  store   <category> <learning> [context]  - Save a new learning"
    echo "  recall  [filter_type] [filter_value]     - Query/search learnings"
    echo "  delete  <learning_id>                    - Remove a learning by ID"
    echo "  list    [limit]                          - List all learnings (shortcut for recall all)"
    echo ""
    echo "Examples:"
    echo "  learning.sh store bug 'useAuth causes hydration error'"
    echo "  learning.sh recall category bug"
    echo "  learning.sh recall search hydration"
    echo "  learning.sh delete abc12345"
    echo "  learning.sh list"
    echo ""
    echo "For detailed help on each command:"
    echo "  learning.sh store"
    echo "  learning.sh recall help"
    echo "  learning.sh delete"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# ============================================================================
# MAIN DISPATCH
# ============================================================================

COMMAND="$1"
shift || true

case "$COMMAND" in
    "store"|"add"|"save")
        cmd_store "$@"
        ;;
    "recall"|"query"|"search"|"find"|"get")
        cmd_recall "$@"
        ;;
    "delete"|"remove"|"rm")
        cmd_delete "$@"
        ;;
    "list"|"ls"|"all")
        cmd_list "$@"
        ;;
    ""|"help"|"-h"|"--help")
        show_main_help
        ;;
    *)
        echo "Unknown command: $COMMAND"
        show_main_help
        exit 1
        ;;
esac
