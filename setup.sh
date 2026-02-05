#!/bin/bash
# Darkroom Claude Code Setup Script v7.0
# Just run it. No flags needed.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${HOME}/.claude"
VERSION="7.0"

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
        "${CLAUDE_DIR}/commands"
        "${CLAUDE_DIR}/skills"
        "${CLAUDE_DIR}/profiles"
        "${CLAUDE_DIR}/rules"
        "${CLAUDE_DIR}/contexts"
        "${CLAUDE_DIR}/tasks"
        "${CLAUDE_DIR}/handoffs"
        "${CLAUDE_DIR}/learnings"
        "${CLAUDE_DIR}/hooks"
        "${CLAUDE_DIR}/memory"
        "${CLAUDE_DIR}/memory/agents"
        "${CLAUDE_DIR}/tldr-cache"
        "${CLAUDE_DIR}/backups"
    )

    for dir in "${dirs[@]}"; do
        mkdir -p "$dir"
    done
}

clean_old_config() {
    rm -f "${CLAUDE_DIR}/scripts/"*.sh 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/agents/"*.md 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/commands/"*.md 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/skills/"*.json 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/skills/"*.md 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/profiles/"*.md 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/rules/"*.md 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/contexts/"*.md 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/hooks/"*.md 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/skill-rules.cache" 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/skill-activation.out" 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/skill-index.compiled" 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/skill-index.checksum" 2>/dev/null || true
    rm -f "${CLAUDE_DIR}/CLAUDE.md" 2>/dev/null || true
}

install_config_files() {
    # CLAUDE.md
    [[ -f "${SCRIPT_DIR}/CLAUDE.md" ]] && cp "${SCRIPT_DIR}/CLAUDE.md" "${CLAUDE_DIR}/"

    # Scripts
    if [[ -d "${SCRIPT_DIR}/scripts" ]]; then
        cp -r "${SCRIPT_DIR}/scripts/"* "${CLAUDE_DIR}/scripts/" 2>/dev/null || true
        chmod +x "${CLAUDE_DIR}/scripts/"*.sh 2>/dev/null || true
    fi

    # Agents
    [[ -d "${SCRIPT_DIR}/agents" ]] && cp -r "${SCRIPT_DIR}/agents/"* "${CLAUDE_DIR}/agents/" 2>/dev/null || true

    # Commands
    [[ -d "${SCRIPT_DIR}/commands" ]] && cp -r "${SCRIPT_DIR}/commands/"* "${CLAUDE_DIR}/commands/" 2>/dev/null || true

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

    # Optional: pipx, agent-browser, llm-tldr
    ensure_pipx
    has_command agent-browser || ensure_npm_global agent-browser@0.8.3 || true
    (has_command tldr || has_command tldr-mcp) || ensure_python_package llm-tldr tldr || true
}

show_summary() {
    echo ""
    box_start "Installed"
    box_line "ok" "CLAUDE.md"
    box_line "ok" "settings.json (permissions, hooks)"
    box_line "ok" "~/.claude.json (MCP servers)"

    local agent_count=$(find "${CLAUDE_DIR}/agents" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    local cmd_count=$(find "${CLAUDE_DIR}/commands" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    local profile_count=$(find "${CLAUDE_DIR}/profiles" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    local rule_count=$(find "${CLAUDE_DIR}/rules" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    local context_count=$(find "${CLAUDE_DIR}/contexts" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')

    box_line "ok" "agents/ ($agent_count)"
    box_line "ok" "commands/ ($cmd_count)"
    box_line "ok" "profiles/ ($profile_count)"
    box_line "ok" "rules/ ($rule_count)"
    box_line "ok" "contexts/ ($context_count)"
    box_line "ok" "skills/"
    box_line "ok" "scripts/"
    box_line "ok" "tasks/"
    box_line "ok" "memory/"
    box_end

    # Show MCP servers from ~/.claude.json (where Claude Code reads them)
    echo ""
    show_claude_json_mcp
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
    install_settings

    info "Compiling skill index..."
    if compile_skill_index; then
        success "Skill index compiled"
    else
        warn "Skill index compilation skipped (will compile on first session)"
    fi

    show_summary

    echo ""
    echo -e "Installed to: ${CYAN}~/.claude/${RESET}"
    echo ""
    success "Restart Claude Code to apply changes."
    echo ""
}

main
