#!/bin/bash
# Unified Handoff Script
# Manages session state for handoffs between sessions
#
# Usage:
#   handoff.sh create [--message "summary"]  - Create a new handoff
#   handoff.sh resume [handoff_id]           - Resume from a handoff (latest if no id)
#   handoff.sh list                          - List available handoffs

set -euo pipefail

HANDOFF_DIR="${HOME}/.claude/handoffs"

# Ensure handoff directory exists
mkdir -p "$HANDOFF_DIR"

# ============================================================================
# SUBCOMMAND: create
# ============================================================================
cmd_create() {
    # Parse --summary / --message flags
    local SUMMARY=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --summary|--message|-m)
                SUMMARY="${2:-}"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done

    # 60-second dedup cooldown — skip if a handoff was created very recently
    local LATEST_HANDOFF="${HANDOFF_DIR}/latest.json"
    if [ -f "$LATEST_HANDOFF" ]; then
        local now=$(date +%s)
        local last_mod=$(stat -f%m "$LATEST_HANDOFF" 2>/dev/null || stat -c%Y "$LATEST_HANDOFF" 2>/dev/null || echo 0)
        local age=$((now - last_mod))
        if [ "$age" -lt 60 ]; then
            echo ""
            echo "HANDOFF SKIPPED (cooldown)"
            echo "------------------------------------"
            echo "Last handoff was ${age}s ago (< 60s cooldown)."
            echo "------------------------------------"
            exit 0
        fi
    fi

    local TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    local HANDOFF_FILE="${HANDOFF_DIR}/handoff_${TIMESTAMP}.json"
    local HANDOFF_MD="${HANDOFF_DIR}/handoff_${TIMESTAMP}.md"

    local PROJECT_DIR=$(pwd)
    local PROJECT_NAME=$(basename "$PROJECT_DIR")

    # Gather git info if available
    local GIT_BRANCH=""
    local GIT_STATUS=""
    if git rev-parse --git-dir > /dev/null 2>&1; then
        GIT_BRANCH=$(git branch --show-current 2>/dev/null)
        GIT_STATUS=$(git status --porcelain 2>/dev/null | head -20)
    fi

    # Create JSON file (use jq for safe escaping)
    local pending_changes
    pending_changes=$(echo "$GIT_STATUS" | grep -c '.' 2>/dev/null || echo 0)

    jq -n \
      --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --arg name "$PROJECT_NAME" \
      --arg path "$PROJECT_DIR" \
      --arg branch "$GIT_BRANCH" \
      --argjson changes "$pending_changes" \
      --arg summary "$SUMMARY" \
      '{timestamp: $ts, project: {name: $name, path: $path}, git: {branch: $branch, pendingChanges: $changes}, context: {summary: $summary, activeTodos: [], keyFiles: [], currentTask: ""}, notes: ""}' \
      > "$HANDOFF_FILE"

    # Create markdown file
    cat > "$HANDOFF_MD" << EOF
# Session Handoff - ${TIMESTAMP}

## Project
- **Name:** ${PROJECT_NAME}
- **Path:** ${PROJECT_DIR}
- **Branch:** ${GIT_BRANCH}

## Pending Changes
\`\`\`
${GIT_STATUS}
\`\`\`

## Session Summary
${SUMMARY:-<!-- Add summary of what was accomplished -->}

## Active Todos
<!-- List any incomplete tasks -->

## Key Files
<!-- List important files for context -->

## Current Task
<!-- Describe what you were working on -->

## Notes for Next Session
<!-- Any important context for resuming -->

---
*Created: $(date)*
*Resume with: \`handoff.sh resume ${TIMESTAMP}\` or \`/resume-handoff ${TIMESTAMP}\`*
EOF

    # Update latest symlinks (relative for portability)
    ln -sf "$(basename "$HANDOFF_FILE")" "${HANDOFF_DIR}/latest.json"
    ln -sf "$(basename "$HANDOFF_MD")" "${HANDOFF_DIR}/latest.md"

    echo ""
    echo "HANDOFF CREATED"
    echo "------------------------------------"
    echo ""
    echo "Files:"
    echo "   JSON: $HANDOFF_FILE"
    echo "   MD:   $HANDOFF_MD"
    echo ""
    echo "Next Steps:"
    echo "   1. Fill in the session summary in the .md file"
    echo "   2. List active todos and key files"
    echo "   3. Note current task for context"
    echo ""
    echo "Resume Command:"
    echo "   handoff.sh resume ${TIMESTAMP}"
    echo "   /resume-handoff ${TIMESTAMP}"
    echo ""
    echo "------------------------------------"

    exit 0
}

# ============================================================================
# SUBCOMMAND: resume
# ============================================================================
cmd_resume() {
    local HANDOFF_ID="${1:-}"

    if [ -z "$HANDOFF_ID" ]; then
        # No ID provided - try to use latest
        if [ -f "${HANDOFF_DIR}/latest.md" ]; then
            local HANDOFF_FILE="${HANDOFF_DIR}/latest.md"
            echo ""
            echo "RESUMING LATEST SESSION"
            echo "------------------------------------"
            echo ""
            cat "$HANDOFF_FILE"
            echo ""
            echo "------------------------------------"
            exit 0
        else
            echo ""
            echo "NO HANDOFF FOUND"
            echo "------------------------------------"
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
            echo "------------------------------------"
            exit 1
        fi
    fi

    local HANDOFF_FILE="${HANDOFF_DIR}/handoff_${HANDOFF_ID}.md"

    if [ ! -f "$HANDOFF_FILE" ]; then
        echo ""
        echo "HANDOFF NOT FOUND"
        echo "------------------------------------"
        echo ""
        echo "Handoff '${HANDOFF_ID}' not found."
        echo ""
        echo "Available handoffs:"
        ls "$HANDOFF_DIR"/*.md 2>/dev/null | while read file; do
            basename "$file" .md | sed 's/handoff_//'
        done
        echo ""
        echo "------------------------------------"
        exit 1
    fi

    echo ""
    echo "RESUMING SESSION: ${HANDOFF_ID}"
    echo "------------------------------------"
    echo ""
    cat "$HANDOFF_FILE"
    echo ""
    echo "------------------------------------"
    echo ""
    echo "Suggested Actions:"
    echo "   1. Review the session summary above"
    echo "   2. Continue from 'Current Task'"
    echo "   3. Check off completed todos"
    echo ""
    echo "------------------------------------"

    exit 0
}

# ============================================================================
# SUBCOMMAND: list
# ============================================================================
cmd_list() {
    echo ""
    echo "AVAILABLE HANDOFFS"
    echo "------------------------------------"
    echo ""

    if [ ! -d "$HANDOFF_DIR" ]; then
        echo "  (no handoffs directory)"
        echo ""
        echo "------------------------------------"
        exit 0
    fi

    local count=0
    for file in "$HANDOFF_DIR"/handoff_*.md; do
        if [ -f "$file" ]; then
            local id=$(basename "$file" .md | sed 's/handoff_//')
            local created=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$file" 2>/dev/null || stat -c "%y" "$file" 2>/dev/null | cut -d. -f1)

            # Extract project name from the file
            local project=$(grep -m1 "^\- \*\*Name:\*\*" "$file" 2>/dev/null | sed 's/.*\*\*Name:\*\* //' || echo "unknown")

            # Check if this is the latest
            local latest_marker=""
            if [ -L "${HANDOFF_DIR}/latest.md" ]; then
                local latest_target=$(readlink "${HANDOFF_DIR}/latest.md")
                if [ "$(basename "$latest_target")" = "$(basename "$file")" ]; then
                    latest_marker=" (latest)"
                fi
            fi

            printf "  %-20s  %-20s  %s%s\n" "$id" "$project" "$created" "$latest_marker"
            count=$((count + 1))
        fi
    done

    if [ $count -eq 0 ]; then
        echo "  (no handoffs found)"
    fi

    echo ""
    echo "------------------------------------"
    echo ""
    echo "Usage:"
    echo "  handoff.sh resume <id>    Resume a specific handoff"
    echo "  handoff.sh resume         Resume the latest handoff"
    echo ""
    echo "------------------------------------"

    exit 0
}

# ============================================================================
# SUBCOMMAND: help
# ============================================================================
cmd_help() {
    echo ""
    echo "HANDOFF - Session State Management"
    echo "------------------------------------"
    echo ""
    echo "Usage: handoff.sh <command> [options]"
    echo ""
    echo "Commands:"
    echo "  create [--summary \"text\"]  Create a new handoff from current session"
    echo "  resume [id]         Resume from a handoff (latest if no id given)"
    echo "  list                List all available handoffs"
    echo "  help                Show this help message"
    echo ""
    echo "Examples:"
    echo "  handoff.sh create"
    echo "  handoff.sh resume"
    echo "  handoff.sh resume 20240115_143022"
    echo "  handoff.sh list"
    echo ""
    echo "------------------------------------"
    exit 0
}

# ============================================================================
# MAIN DISPATCHER
# ============================================================================
COMMAND="${1:-help}"
shift 2>/dev/null || true

case "$COMMAND" in
    create)
        cmd_create "$@"
        ;;
    resume)
        cmd_resume "$@"
        ;;
    list)
        cmd_list "$@"
        ;;
    help|--help|-h)
        cmd_help
        ;;
    *)
        echo "Unknown command: $COMMAND"
        echo "Run 'handoff.sh help' for usage information."
        exit 1
        ;;
esac
