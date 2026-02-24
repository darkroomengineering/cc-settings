#!/usr/bin/env bash
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
        ls -1t "$dir"/handoff_*.json 2>/dev/null | tail -n +$((keep + 1)) | xargs rm -f
        ls -1t "$dir"/handoff_*.md 2>/dev/null | tail -n +$((keep + 1)) | xargs rm -f
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

# Clean per-session temp files from previous session
rm -f "${CLAUDE_DIR}/tmp/tool-failure-counts" "${CLAUDE_DIR}/tmp/heavy-skill-active" 2>/dev/null

# Log rotation (parallel)
rotate_log "${CLAUDE_DIR}/sessions.log" &
pid_sessions=$!
rotate_log "${CLAUDE_DIR}/edits.log" &
pid_edits=$!
rotate_log "${CLAUDE_DIR}/hooks.log" &
pid_hooks=$!
rotate_log "${CLAUDE_DIR}/safety-net.log" &
pid_safety=$!
rotate_log "${CLAUDE_DIR}/logs/tool-failures.log" &
pid_failures=$!

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
wait $pid_edits $pid_hooks $pid_safety $pid_failures $pid_handoffs $pid_skills $pid_compile 2>/dev/null

# --- Phase 4b: Auto-sync AGENTS.md for cross-tool compatibility ---
sync_agents_md() {
    local source_agents="${CLAUDE_DIR}/AGENTS.md"
    local project_agents="${PROJECT_DIR}/AGENTS.md"
    local version_file="${CLAUDE_DIR}/.cc-settings-version"

    # Only run in git repos
    [[ -d "${PROJECT_DIR}/.git" ]] || return 0
    # Need the source file
    [[ -f "$source_agents" ]] || return 0

    # Get installed version
    local installed_version="unknown"
    if [[ -f "$version_file" ]] && command -v jq &>/dev/null; then
        installed_version=$(jq -r '.version // "unknown"' "$version_file" 2>/dev/null)
    fi

    if [[ ! -f "$project_agents" ]]; then
        # No AGENTS.md in project — create it
        {
            echo "<!-- cc-settings v${installed_version} | $(date -u +%Y-%m-%dT%H:%M:%SZ) | DO NOT EDIT — managed by cc-settings -->"
            cat "$source_agents"
        } > "$project_agents"
        echo ""
        echo "AGENTS.md added to project root (v${installed_version})"
        echo "Commit it to share coding standards with your team and all AI tools."
    elif head -1 "$project_agents" 2>/dev/null | grep -q "cc-settings" 2>/dev/null; then
        # Managed file — check if outdated
        local proj_version=""
        local header
        header=$(head -1 "$project_agents" 2>/dev/null)
        if [[ "$header" =~ cc-settings\ v([0-9.]+) ]]; then
            proj_version="${BASH_REMATCH[1]}"
        fi

        if [[ -n "$proj_version" ]] && [[ "$proj_version" != "$installed_version" ]] && [[ "$installed_version" != "unknown" ]]; then
            {
                echo "<!-- cc-settings v${installed_version} | $(date -u +%Y-%m-%dT%H:%M:%SZ) | DO NOT EDIT — managed by cc-settings -->"
                cat "$source_agents"
            } > "$project_agents"
            echo ""
            echo "AGENTS.md updated: v${proj_version} -> v${installed_version}"
        fi
    fi
    # If file exists but isn't managed by cc-settings, don't touch it
}
sync_agents_md

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
            .learnings | sort_by(.timestamp) | reverse | .[:3] | .[] |
            "  - [\(.category)] \(.learning)"
        ' "$LEARNINGS_FILE" 2>/dev/null
        echo ""
        echo "Run: learning.sh recall"
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

# CLAUDE.md size monitoring
# Large CLAUDE.md files degrade model adherence -- warn early
CLAUDE_MD="${CLAUDE_DIR}/CLAUDE.md"
if [[ -f "$CLAUDE_MD" ]]; then
    # Read thresholds from hook config if available, otherwise use defaults
    HOOK_CONFIG_LIB="${CLAUDE_DIR}/lib/hook-config.sh"
    if [[ -f "$HOOK_CONFIG_LIB" ]]; then
        source "$HOOK_CONFIG_LIB"
        CLAUDE_MD_ENABLED=$(get_hook_config "claude_md_monitor.enabled" "true")
        CLAUDE_MD_WARN=$(get_hook_config "claude_md_monitor.warn_lines" "400")
        CLAUDE_MD_CRIT=$(get_hook_config "claude_md_monitor.critical_lines" "600")
    else
        # Hardcoded defaults -- can be made configurable via lib/hook-config.sh
        CLAUDE_MD_ENABLED="true"
        CLAUDE_MD_WARN=400
        CLAUDE_MD_CRIT=600
    fi

    if [[ "$CLAUDE_MD_ENABLED" == "true" ]]; then
        CLAUDE_MD_LINES=$(wc -l < "$CLAUDE_MD" | tr -d ' ')
        if [[ "$CLAUDE_MD_LINES" -gt "$CLAUDE_MD_CRIT" ]]; then
            echo ""
            echo "WARNING: CLAUDE.md is ${CLAUDE_MD_LINES} lines (critical threshold). Adherence may degrade. Run: wc -l ~/.claude/CLAUDE.md"
        elif [[ "$CLAUDE_MD_LINES" -gt "$CLAUDE_MD_WARN" ]]; then
            echo ""
            echo "WARNING: CLAUDE.md is ${CLAUDE_MD_LINES} lines (recommended: <${CLAUDE_MD_WARN}). Consider moving sections to rules/ or profiles/."
        fi
    fi
fi
