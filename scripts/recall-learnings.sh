#!/bin/bash
# Recall Learnings Script
# Queries per-project learnings for cross-session memory

PROJECT_NAME=$(basename "$(pwd)")
LEARNINGS_BASE="${HOME}/.claude/learnings"
LEARNINGS_DIR="${LEARNINGS_BASE}/${PROJECT_NAME}"
LEARNINGS_FILE="${LEARNINGS_DIR}/learnings.json"

FILTER_TYPE="$1"
FILTER_VALUE="$2"
LIMIT="${3:-10}"

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

if [ "$FILTER_TYPE" = "project" ] && [ -n "$FILTER_VALUE" ]; then
    LEARNINGS_DIR="${LEARNINGS_BASE}/${FILTER_VALUE}"
    LEARNINGS_FILE="${LEARNINGS_DIR}/learnings.json"
    PROJECT_NAME="$FILTER_VALUE"
fi

if [ ! -f "$LEARNINGS_FILE" ]; then
    echo ""
    echo "📚 NO LEARNINGS FOR: $PROJECT_NAME"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "No learnings stored for this project."
    echo "Use store-learning.sh to add some."
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

show_help() {
    echo ""
    echo "📚 RECALL LEARNINGS (Project: $PROJECT_NAME)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Usage: recall-learnings.sh [filter_type] [filter_value] [limit]"
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
    echo "  recall-learnings.sh all"
    echo "  recall-learnings.sh all-projects"
    echo "  recall-learnings.sh category bug"
    echo "  recall-learnings.sh project other-app"
    echo "  recall-learnings.sh search hydration"
    echo "  recall-learnings.sh recent 5"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

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
        show_help
        ;;
    "all")
        RESULT=$(jq ".learnings | .[-$LIMIT:]" "$LEARNINGS_FILE")
        print_learnings "$RESULT"
        ;;
    "category"|"cat")
        if [ -z "$FILTER_VALUE" ]; then
            echo "Error: category requires a value"
            show_help
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
            show_help
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
        RESULT=$(jq --arg kw "$FILTER_TYPE" '[.learnings[] | select(.learning | ascii_downcase | contains($kw | ascii_downcase))] | .[-'"$LIMIT"':]' "$LEARNINGS_FILE")
        print_learnings "$RESULT"
        ;;
esac

exit 0
