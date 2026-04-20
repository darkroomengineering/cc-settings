#!/usr/bin/env bash
# Darkroom Claude Code Setup Script v8.0
# Just run it. No flags needed.

set -euo pipefail

# =============================================================================
# BOOTSTRAP: Handle `bash <(curl ...)` by cloning to a temp directory
# =============================================================================
# When run via process substitution, BASH_SOURCE[0] points to /dev/fd/XX
# which means we can't resolve lib/ relative to the script. Detect this and
# auto-clone the repo so everything works.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$SCRIPT_DIR" == "/dev/fd" || "$SCRIPT_DIR" == /proc/self/fd* ]]; then
    REPO_URL="https://github.com/darkroomengineering/cc-settings.git"
    CLONE_DIR="$(mktemp -d)"

    cleanup_clone() { rm -rf "$CLONE_DIR"; }
    trap cleanup_clone EXIT

    echo "Fetching cc-settings..."
    if command -v git &>/dev/null; then
        git clone --depth 1 "$REPO_URL" "$CLONE_DIR" 2>/dev/null
    else
        echo "ERROR: git is required for remote install."
        echo "Install git or clone manually: git clone $REPO_URL && bash cc-settings/setup.sh"
        exit 1
    fi

    bash "$CLONE_DIR/setup.sh" "$@"
    exit $?
fi

CLAUDE_DIR="${HOME}/.claude"
VERSION="8.0"

# =============================================================================
# SOURCE LIBRARY FILES
# =============================================================================

source_libs() {
    local lib_dir="${SCRIPT_DIR}/lib"

    if [[ ! -d "$lib_dir" ]]; then
        echo "ERROR: Library directory not found: $lib_dir"
        echo "Please ensure setup.sh is run from the cc-settings directory."
        exit 1
    fi

    source "${lib_dir}/colors.sh"
    source "${lib_dir}/platform.sh"
    source "${lib_dir}/prompts.sh"
    source "${lib_dir}/packages.sh"
    source "${lib_dir}/mcp.sh"
}

source_libs

# =============================================================================
# BACKUP
# =============================================================================

create_backup() {
    local timestamp
    timestamp=$(get_timestamp)
    local backup_dir="${CLAUDE_DIR}/backups"

    mkdir -p "$backup_dir"

    local files_to_backup=()
    [[ -f "${CLAUDE_DIR}/settings.json" ]] && files_to_backup+=("settings.json")
    [[ -f "${CLAUDE_DIR}/CLAUDE.md" ]] && files_to_backup+=("CLAUDE.md")
    [[ -f "${CLAUDE_DIR}/AGENTS.md" ]] && files_to_backup+=("AGENTS.md")

    if [[ ${#files_to_backup[@]} -eq 0 ]]; then
        return 0
    fi

    (cd "$CLAUDE_DIR" && tar -czf "${backup_dir}/backup-${timestamp}.tar.gz" "${files_to_backup[@]}" 2>/dev/null) || true

    # Keep last 5 backups (remove all but the 5 most recent)
    local backup_count
    backup_count=$(find "$backup_dir" -name "backup-*.tar.gz" -type f 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$backup_count" -gt 5 ]]; then
        find "$backup_dir" -name "backup-*.tar.gz" -type f 2>/dev/null | sort | head -n $((backup_count - 5)) | xargs rm -f 2>/dev/null || true
    fi
}

# =============================================================================
# ERROR HANDLING
# =============================================================================

cleanup_on_error() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        echo ""
        error "Setup failed with exit code: $exit_code"
    fi
}

trap cleanup_on_error EXIT

# =============================================================================
# INSTALLATION
# =============================================================================

create_directories() {
    local dirs=(
        "${CLAUDE_DIR}/scripts"
        "${CLAUDE_DIR}/agents"
        "${CLAUDE_DIR}/skills"
        "${CLAUDE_DIR}/profiles"
        "${CLAUDE_DIR}/rules"
        "${CLAUDE_DIR}/contexts"
        "${CLAUDE_DIR}/handoffs"
        "${CLAUDE_DIR}/learnings"
        "${CLAUDE_DIR}/hooks"
        "${CLAUDE_DIR}/memory"
        "${CLAUDE_DIR}/memory/agents"
        "${CLAUDE_DIR}/lib"
        "${CLAUDE_DIR}/docs"
        "${CLAUDE_DIR}/tldr-cache"
        "${CLAUDE_DIR}/backups"
        "${CLAUDE_DIR}/tmp"
        "${CLAUDE_DIR}/logs"
        "${CLAUDE_DIR}/src"
        "${CLAUDE_DIR}/src/scripts"
        "${CLAUDE_DIR}/src/hooks"
        "${CLAUDE_DIR}/src/lib"
        "${CLAUDE_DIR}/src/schemas"
    )

    for dir in "${dirs[@]}"; do
        mkdir -p "$dir"
    done
}

# Install TypeScript ports into ~/.claude/src/ so hooks can invoke them
# directly (CC_USE_TS_HOOKS=1 contract; see docs/migration-coexistence.md).
# Bash implementations remain installed — this is strictly additive during
# Phases 4–6.
install_ts_sources() {
    if [[ ! -d "${SCRIPT_DIR}/src" ]]; then
        return 0
    fi
    # Clean previous TS install so stale ports don't linger.
    rm -rf "${CLAUDE_DIR}/src" 2>/dev/null || true
    mkdir -p "${CLAUDE_DIR}/src"
    cp -r "${SCRIPT_DIR}/src/"* "${CLAUDE_DIR}/src/" 2>/dev/null || true

    # package.json + node_modules aren't installed under ~/.claude — deps
    # (zod, @inquirer/prompts, yaml) are loaded from the repo the user
    # cloned. Phase 5 proper will provision a dedicated runtime dir.
    # For now, link back to the source repo so `bun` resolves deps correctly.
    if [[ -f "${SCRIPT_DIR}/package.json" ]]; then
        cp "${SCRIPT_DIR}/package.json" "${CLAUDE_DIR}/src/package.json"
    fi
    if [[ -f "${SCRIPT_DIR}/tsconfig.json" ]]; then
        cp "${SCRIPT_DIR}/tsconfig.json" "${CLAUDE_DIR}/src/tsconfig.json"
    fi
}

clean_old_config() {
    rm -f "${CLAUDE_DIR}/lib/"*.sh 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/scripts/"*.sh 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/agents/"*.md 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/skills/"*.json 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/skills/"*.md 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/profiles/"*.md 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/rules/"*.md 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/contexts/"*.md 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/hooks/"*.md 2>/dev/null || true
    # Only remove known managed skill directories (preserve user-created custom skills)
    local managed_skills=(
        ask audit autoresearch build checkpoint component consolidate context
        create-handoff debug design-tokens discovery docs explore f-thread
        figma fix hook init l-thread learn lenis lighthouse orchestrate prd premortem
        project qa refactor resume-handoff review ship teams test tldr verify versions
    )
    for skill_dir in "${managed_skills[@]}"; do
        rm -rf "${CLAUDE_DIR}/skills/${skill_dir}" 2>/dev/null || true
    done
    rm -f "${CLAUDE_DIR}/docs/"*.md 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/skill-rules.cache" 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/skill-activation.out" 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/skill-index.compiled" 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/skill-index.checksum" 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/CLAUDE.md" 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/AGENTS.md" 2>/dev/null || true
}

install_config_files() {
    # CLAUDE.md (Claude-Code-specific config from CLAUDE-FULL.md)
    [[ -f "${SCRIPT_DIR}/CLAUDE-FULL.md" ]] && cp "${SCRIPT_DIR}/CLAUDE-FULL.md" "${CLAUDE_DIR}/CLAUDE.md"

    # AGENTS.md (portable coding standards — reference copy for projects)
    [[ -f "${SCRIPT_DIR}/AGENTS.md" ]] && cp "${SCRIPT_DIR}/AGENTS.md" "${CLAUDE_DIR}/AGENTS.md"

    # Lib (shared libraries used by scripts)
    [[ -d "${SCRIPT_DIR}/lib" ]] && cp -r "${SCRIPT_DIR}/lib/"* "${CLAUDE_DIR}/lib/" 2>/dev/null || true

    # Scripts
    if [[ -d "${SCRIPT_DIR}/scripts" ]]; then
        cp -r "${SCRIPT_DIR}/scripts/"* "${CLAUDE_DIR}/scripts/" 2>/dev/null || true
        chmod +x "${CLAUDE_DIR}/scripts/"*.sh 2>/dev/null || true
    fi

    # Agents
    [[ -d "${SCRIPT_DIR}/agents" ]] && cp -r "${SCRIPT_DIR}/agents/"* "${CLAUDE_DIR}/agents/" 2>/dev/null || true

    # Skills
    [[ -d "${SCRIPT_DIR}/skills" ]] && cp -r "${SCRIPT_DIR}/skills/"* "${CLAUDE_DIR}/skills/" 2>/dev/null || true

    # Profiles
    [[ -d "${SCRIPT_DIR}/profiles" ]] && cp -r "${SCRIPT_DIR}/profiles/"* "${CLAUDE_DIR}/profiles/" 2>/dev/null || true

    # Rules (path-conditioned)
    [[ -d "${SCRIPT_DIR}/rules" ]] && cp -r "${SCRIPT_DIR}/rules/"* "${CLAUDE_DIR}/rules/" 2>/dev/null || true

    # Contexts (ecosystem profiles)
    [[ -d "${SCRIPT_DIR}/contexts" ]] && cp -r "${SCRIPT_DIR}/contexts/"* "${CLAUDE_DIR}/contexts/" 2>/dev/null || true

    # Hooks
    [[ -d "${SCRIPT_DIR}/hooks" ]] && cp -r "${SCRIPT_DIR}/hooks/"* "${CLAUDE_DIR}/hooks/" 2>/dev/null || true

    # Docs
    [[ -d "${SCRIPT_DIR}/docs" ]] && cp -r "${SCRIPT_DIR}/docs/"* "${CLAUDE_DIR}/docs/" 2>/dev/null || true

    # Hook config (team defaults - only install if missing or older than source)
    if [[ -f "${SCRIPT_DIR}/hooks-config.json" ]]; then
        local src_config="${SCRIPT_DIR}/hooks-config.json"
        local dst_config="${CLAUDE_DIR}/hooks-config.json"
        if [[ ! -f "$dst_config" ]] || [[ "$src_config" -nt "$dst_config" ]]; then
            cp "$src_config" "$dst_config"
        fi
    fi
}

compile_skill_index() {
    # Compile skill index for fast skill matching
    local compile_script="${CLAUDE_DIR}/scripts/compile-skills.sh"
    if [[ -f "$compile_script" ]] && [[ -x "$compile_script" ]]; then
        "$compile_script" --force >/dev/null 2>&1 && return 0
    fi
    return 1
}

install_settings() {
    local team_settings="${SCRIPT_DIR}/settings.json"
    local existing_settings="${CLAUDE_DIR}/settings.json"

    if [[ ! -f "$team_settings" ]]; then
        error "Team settings.json not found"
        return 1
    fi

    # Install permissions, hooks, etc. to ~/.claude/settings.json
    handle_mcp_preservation "$existing_settings" "$team_settings" "${CLAUDE_DIR}/settings.json"

    # IMPORTANT: Install MCP servers to ~/.claude.json (where Claude Code actually reads them)
    # Claude Code reads MCP from ~/.claude.json, NOT from ~/.claude/settings.json
    install_mcp_to_claude_json "$team_settings"
}

install_dependencies() {
    detect_platform
    detect_package_managers

    # Required: jq
    if ! has_command jq; then
        ensure_system_package jq || warn "Please install jq manually: $(get_install_hint jq)"
    fi

    # Optional: pipx, pinchtab, agent-browser, llm-tldr
    ensure_pipx
    has_command pinchtab || ensure_npm_global pinchtab || true
    has_command agent-browser || ensure_npm_global agent-browser || true
    (has_command tldr || has_command tldr-mcp) || ensure_python_package llm-tldr tldr || true
}

write_version_sentinel() {
    local sentinel="${CLAUDE_DIR}/.cc-settings-version"
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    if command -v jq &>/dev/null; then
        jq -n \
            --arg version "$VERSION" \
            --arg installed_at "$timestamp" \
            --arg installer "setup.sh" \
            '{version: $version, installed_at: $installed_at, installer: $installer}' \
            > "$sentinel"
    else
        # Fallback if jq not available
        cat > "$sentinel" << EOF
{"version":"${VERSION}","installed_at":"${timestamp}","installer":"setup.sh"}
EOF
    fi
}

show_summary() {
    echo ""
    box_start "Installed"
    box_line "ok" "CLAUDE.md (Claude-Code config)"
    box_line "ok" "AGENTS.md (portable standards)"
    box_line "ok" "settings.json (permissions, hooks)"
    box_line "ok" "~/.claude.json (MCP servers)"

    local agent_count=$(find "${CLAUDE_DIR}/agents" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    local profile_count=$(find "${CLAUDE_DIR}/profiles" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    local rule_count=$(find "${CLAUDE_DIR}/rules" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    local context_count=$(find "${CLAUDE_DIR}/contexts" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')

    box_line "ok" "agents/ ($agent_count)"
    box_line "ok" "profiles/ ($profile_count)"
    box_line "ok" "rules/ ($rule_count)"
    box_line "ok" "contexts/ ($context_count)"
    box_line "ok" "skills/"
    box_line "ok" "scripts/"
    box_line "ok" "docs/"
    box_line "ok" "memory/"
    box_line "ok" "hooks-config.json"
    box_end

    # Show MCP servers from ~/.claude.json (where Claude Code reads them)
    echo ""
    show_claude_json_mcp
}

# =============================================================================
# ROLLBACK — restore the newest settings.json backup
# =============================================================================
# Usage:
#   bash setup.sh --rollback                         # newest backup
#   bash setup.sh --rollback=2026-04-20T10-00-00Z    # specific timestamp
# The bash setup creates tar.gz backups in ~/.claude/backups/backup-*.tar.gz
# containing settings.json + CLAUDE.md + AGENTS.md.

cmd_rollback() {
    local target="${1:-}"
    local backup_dir="${CLAUDE_DIR}/backups"

    if [[ ! -d "$backup_dir" ]]; then
        echo "ERROR: No backups directory found at $backup_dir"
        exit 1
    fi

    local backup_file
    if [[ -z "$target" ]]; then
        # Newest backup-*.tar.gz
        backup_file=$(find "$backup_dir" -name "backup-*.tar.gz" -type f 2>/dev/null | sort -r | head -1)
    else
        # Match by timestamp substring.
        backup_file=$(find "$backup_dir" -name "backup-${target}*.tar.gz" -type f 2>/dev/null | head -1)
    fi

    if [[ -z "$backup_file" ]] || [[ ! -f "$backup_file" ]]; then
        echo "ERROR: No matching backup found."
        echo "Available backups:"
        find "$backup_dir" -name "backup-*.tar.gz" -type f 2>/dev/null | sort -r | head -5
        exit 1
    fi

    echo "Rolling back from: $backup_file"
    (cd "$CLAUDE_DIR" && tar -xzf "$backup_file")
    echo "Restored. Restart Claude Code to apply."
    exit 0
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    show_banner "$VERSION"

    info "Installing dependencies..."
    install_dependencies

    info "Creating backup..."
    create_backup

    info "Installing configuration..."
    create_directories
    clean_old_config
    install_config_files
    install_ts_sources
    install_settings

    info "Compiling skill index..."
    if compile_skill_index; then
        success "Skill index compiled"
    else
        warn "Skill index compilation skipped (will compile on first session)"
    fi

    # Write version sentinel (enables staleness detection and cross-tool sync)
    write_version_sentinel

    show_summary

    echo ""
    echo -e "Installed to: ${CYAN}~/.claude/${RESET}"
    echo ""
    info "Set up cross-tool AI config in any project:"
    echo -e "  ${CYAN}~/.claude/scripts/project-init.sh /path/to/project${RESET}"
    echo ""
    success "Restart Claude Code to apply changes."
    echo ""
}

# Handle --rollback BEFORE main — never installs when rolling back.
case "${1:-}" in
    --rollback)
        cmd_rollback ""
        ;;
    --rollback=*)
        cmd_rollback "${1#--rollback=}"
        ;;
esac

main
