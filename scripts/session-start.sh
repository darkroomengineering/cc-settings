#!/bin/bash
# Session Start Hook
# Runs when a new Claude Code session begins
# - Rotates logs (parallel)
# - Cleans old handoffs (parallel)
# - Auto-warms tldr index (background)
# - Recalls project learnings

CLAUDE_DIR="${HOME}/.claude"
PROJECT_DIR="$(pwd)"
PROJECT_NAME=$(basename "$PROJECT_DIR")

# ============================================
# Parallel helper functions
# ============================================

# Rotate a single log file if over max size
# Usage: rotate_log <log_file> [max_size_bytes]
rotate_log() {
    local log="$1"
    local max_size="${2:-1048576}"  # 1MB default

    if [[ -f "$log" ]]; then
        local size
        size=$(stat -f%z "$log" 2>/dev/null || stat -c%s "$log" 2>/dev/null || echo 0)
        if [[ "$size" -gt "$max_size" ]]; then
            mv "$log" "${log}.old"
        fi
    fi
}

# Clean old handoff files, keeping the most recent N
# Usage: cleanup_handoffs <directory> [keep_count]
cleanup_handoffs() {
    local dir="$1"
    local keep="${2:-20}"

    if [[ -d "$dir" ]]; then
        ls -1t "$dir"/handoff_*.json 2>/dev/null | tail -n +$((keep + 1)) | xargs -r rm -f
        ls -1t "$dir"/handoff_*.md 2>/dev/null | tail -n +$((keep + 1)) | xargs -r rm -f
    fi
}

# Pre-warm jq and skills file into filesystem cache
prewarm_skills() {
    local skills_file="$1"
    if [[ -f "$skills_file" ]] && command -v jq &>/dev/null; then
        jq empty "$skills_file" 2>/dev/null
    fi
}

# Auto-warm tldr index if available and not already warmed
# Runs completely detached (survives script exit)
auto_warm_tldr() {
    # Check if tldr is installed
    if ! command -v tldr &>/dev/null; then
        return 0
    fi

    # Check if this is a code project (has common project markers)
    if [[ ! -f "$PROJECT_DIR/package.json" ]] && \
       [[ ! -f "$PROJECT_DIR/Cargo.toml" ]] && \
       [[ ! -f "$PROJECT_DIR/go.mod" ]] && \
       [[ ! -f "$PROJECT_DIR/pyproject.toml" ]] && \
       [[ ! -f "$PROJECT_DIR/setup.py" ]] && \
       [[ ! -f "$PROJECT_DIR/Makefile" ]] && \
       [[ ! -d "$PROJECT_DIR/.git" ]]; then
        return 0
    fi

    # Check if already warmed (look for .tldr directory or cache)
    local tldr_cache="${CLAUDE_DIR}/tldr-cache/${PROJECT_NAME}.warmed"
    local tldr_index="$PROJECT_DIR/.tldr"

    if [[ -d "$tldr_index" ]]; then
        # Already has a tldr index
        return 0
    fi

    # Check if we've tried warming recently (within last hour) to avoid repeated attempts
    if [[ -f "$tldr_cache" ]]; then
        local cache_age=$(($(date +%s) - $(stat -f%m "$tldr_cache" 2>/dev/null || stat -c%Y "$tldr_cache" 2>/dev/null || echo 0)))
        if [[ "$cache_age" -lt 3600 ]]; then
            return 0
        fi
    fi

    # Determine language flag based on project type
    local lang_flag=""
    if [[ -f "$PROJECT_DIR/tsconfig.json" ]] || [[ -f "$PROJECT_DIR/package.json" ]]; then
        lang_flag="--lang typescript"
    elif [[ -f "$PROJECT_DIR/Cargo.toml" ]]; then
        lang_flag="--lang rust"
    elif [[ -f "$PROJECT_DIR/go.mod" ]]; then
        lang_flag="--lang go"
    elif [[ -f "$PROJECT_DIR/pyproject.toml" ]] || [[ -f "$PROJECT_DIR/setup.py" ]]; then
        lang_flag="--lang python"
    fi

    # Create cache directory
    mkdir -p "${CLAUDE_DIR}/tldr-cache"

    # Mark that we're attempting to warm (prevents repeated attempts)
    touch "$tldr_cache"

    # Run tldr warm in background (completely non-blocking, survives script exit)
    (
        cd "$PROJECT_DIR" && \
        tldr warm . $lang_flag >/dev/null 2>&1 && \
        echo "$(date '+%Y-%m-%d %H:%M:%S') - TLDR warmed: $PROJECT_NAME" >> "${CLAUDE_DIR}/sessions.log"
    ) &
    disown
}

# ============================================
# Main execution - parallel where possible
# ============================================

# --- Phase 1: Fire off all independent background tasks ---

# Log rotation (parallel)
rotate_log "${CLAUDE_DIR}/sessions.log" &
pid_sessions=$!
rotate_log "${CLAUDE_DIR}/edits.log" &
pid_edits=$!
rotate_log "${CLAUDE_DIR}/hooks.log" &
pid_hooks=$!

# Handoff cleanup (parallel with log rotation)
cleanup_handoffs "${CLAUDE_DIR}/handoffs" 20 &
pid_handoffs=$!

# Skills file pre-warm (parallel)
prewarm_skills "${CLAUDE_DIR}/skills/skill-rules.json" &
pid_skills=$!

# Compile skill index if needed (parallel, non-blocking)
# This creates a fast-lookup index for skill matching
compile_skill_index() {
    local compile_script="${CLAUDE_DIR}/scripts/compile-skills.sh"
    if [[ -f "$compile_script" ]] && [[ -x "$compile_script" ]]; then
        "$compile_script" >/dev/null 2>&1
    fi
}
compile_skill_index &
pid_compile=$!

# --- Phase 2: Wait for critical tasks before logging ---
# We need log rotation to complete before writing to sessions.log
wait $pid_sessions 2>/dev/null

# Log session start
echo "$(date '+%Y-%m-%d %H:%M:%S') - Session started in $PROJECT_DIR" >> "${CLAUDE_DIR}/sessions.log"

# --- Phase 3: Fire and forget long-running task ---
# TLDR warming runs completely detached (survives script exit)
auto_warm_tldr

# --- Phase 4: Wait for remaining background tasks ---
# These should complete quickly, but ensure they finish before script exits
wait $pid_edits $pid_hooks $pid_handoffs $pid_skills $pid_compile 2>/dev/null

# --- Phase 5: Display output (must be sequential for clean terminal output) ---

# Display learnings if available
LEARNINGS_BASE="${CLAUDE_DIR}/learnings"
LEARNINGS_FILE="${LEARNINGS_BASE}/${PROJECT_NAME}/learnings.json"

if [[ -f "$LEARNINGS_FILE" ]] && command -v jq &>/dev/null; then
    PROJECT_LEARNINGS=$(jq '.learnings | length' "$LEARNINGS_FILE" 2>/dev/null)
    TOTAL_PROJECTS=$(find "$LEARNINGS_BASE" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')

    if [[ "$PROJECT_LEARNINGS" -gt 0 ]] 2>/dev/null; then
        echo ""
        echo "MEMORY SYSTEM ACTIVE"
        echo "------------------------------------"
        echo ""
        echo "Project: $PROJECT_NAME"
        echo "Learnings: $PROJECT_LEARNINGS for this project ($TOTAL_PROJECTS projects tracked)"
        echo ""
        echo "Recent learnings:"
        jq -r '
            .learnings | .[-3:] | .[] |
            "  - [\(.category)] \(.learning)"
        ' "$LEARNINGS_FILE" 2>/dev/null
        echo ""
        echo "Run: recall-learnings.sh all"
        echo "------------------------------------"
    fi
fi

# Show tldr status if installed
if command -v tldr &>/dev/null; then
    if [[ -d "$PROJECT_DIR/.tldr" ]]; then
        echo ""
        echo "TLDR index available for semantic search"
    else
        echo ""
        echo "TLDR warming in background (semantic search coming soon)"
    fi
fi
