#!/bin/bash
# Darkroom Claude Code Setup Script v5.1
# Batteries Included - Auto-installs all dependencies
# Supports: macOS, Linux, Windows (Git Bash/WSL)

set -e

# =============================================================================
# CONFIGURATION
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${HOME}/.claude"
VERSION="5.1"

# Default options
MINIMAL=false
SKIP_DEPS=false
PRESERVE_MCP=true
INTERACTIVE=true
DRY_RUN=false
DO_ROLLBACK=false
BACKUP_FILE=""

# =============================================================================
# SOURCE LIBRARY FILES
# =============================================================================

# Source all library files
source_libs() {
    local lib_dir="${SCRIPT_DIR}/lib"

    if [[ ! -d "$lib_dir" ]]; then
        echo "ERROR: Library directory not found: $lib_dir"
        echo "Please ensure setup.sh is run from the team-config directory."
        exit 1
    fi

    # Source in dependency order
    source "${lib_dir}/colors.sh"
    source "${lib_dir}/platform.sh"
    source "${lib_dir}/prompts.sh"
    source "${lib_dir}/packages.sh"
    source "${lib_dir}/mcp.sh"
}

source_libs

# =============================================================================
# ARGUMENT PARSING
# =============================================================================

show_help() {
    echo "Darkroom Claude Code Setup v${VERSION}"
    echo ""
    echo "Usage: setup.sh [options]"
    echo ""
    echo "Options:"
    echo "  --minimal          Skip optional tools (agent-browser, tldr, pipx)"
    echo "  --skip-deps        Skip all dependency installation"
    echo "  --preserve-mcp     Preserve custom MCP servers from existing config (default)"
    echo "  --no-preserve-mcp  Don't preserve custom MCP servers"
    echo "  --no-interactive   Run without prompts (use defaults)"
    echo "  --dry-run          Show what would be done without making changes"
    echo "  --rollback         Restore from the most recent backup"
    echo "  --help, -h         Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./setup.sh                      # Full interactive setup"
    echo "  ./setup.sh --minimal            # Quick setup, skip optional tools"
    echo "  ./setup.sh --no-interactive     # CI/automated setup"
    echo "  ./setup.sh --rollback           # Restore previous configuration"
    echo ""
}

parse_args() {
    for arg in "$@"; do
        case $arg in
            --minimal)
                MINIMAL=true
                ;;
            --skip-deps)
                SKIP_DEPS=true
                ;;
            --preserve-mcp)
                PRESERVE_MCP=true
                ;;
            --no-preserve-mcp)
                PRESERVE_MCP=false
                ;;
            --no-interactive)
                INTERACTIVE=false
                disable_prompts
                ;;
            --dry-run)
                DRY_RUN=true
                ;;
            --rollback)
                DO_ROLLBACK=true
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                warn "Unknown option: $arg"
                ;;
        esac
    done
}

# =============================================================================
# BACKUP AND ROLLBACK
# =============================================================================

# Create a timestamped backup of the Claude config directory
create_backup() {
    local timestamp
    timestamp=$(get_timestamp)
    local backup_dir="${CLAUDE_DIR}/backups"
    BACKUP_FILE="${backup_dir}/backup-${timestamp}.tar.gz"

    mkdir -p "$backup_dir"

    # Files to backup
    local files_to_backup=()
    [[ -f "${CLAUDE_DIR}/settings.json" ]] && files_to_backup+=("settings.json")
    [[ -f "${CLAUDE_DIR}/CLAUDE.md" ]] && files_to_backup+=("CLAUDE.md")

    if [[ ${#files_to_backup[@]} -eq 0 ]]; then
        debug "No existing files to backup"
        BACKUP_FILE=""
        return 0
    fi

    info "Creating backup: ${BACKUP_FILE}"

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would backup: ${files_to_backup[*]}"
        return 0
    fi

    # Create tarball
    (cd "$CLAUDE_DIR" && tar -czf "$BACKUP_FILE" "${files_to_backup[@]}" 2>/dev/null) || {
        warn "Could not create backup tarball, falling back to simple copy"
        for f in "${files_to_backup[@]}"; do
            cp "${CLAUDE_DIR}/${f}" "${backup_dir}/${f}.${timestamp}.bak" 2>/dev/null || true
        done
    }

    progress_ok "Backup created"

    # Clean old backups (keep last 5)
    local backup_count
    backup_count=$(find "$backup_dir" -name "backup-*.tar.gz" 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$backup_count" -gt 5 ]]; then
        debug "Cleaning old backups (keeping last 5)"
        find "$backup_dir" -name "backup-*.tar.gz" -type f | sort | tail -n +6 | xargs rm -f 2>/dev/null || true
    fi
}

# Rollback to the most recent backup
do_rollback() {
    local backup_dir="${CLAUDE_DIR}/backups"

    if [[ ! -d "$backup_dir" ]]; then
        error "No backup directory found at: $backup_dir"
        exit 1
    fi

    # Find most recent backup
    local latest_backup
    latest_backup=$(find "$backup_dir" -name "backup-*.tar.gz" -type f 2>/dev/null | sort -r | head -1)

    if [[ -z "$latest_backup" ]]; then
        error "No backups found in: $backup_dir"
        exit 1
    fi

    info "Found backup: $latest_backup"
    echo ""

    if [[ "$INTERACTIVE" == true ]]; then
        if ! prompt_yn "Restore this backup?"; then
            info "Rollback cancelled"
            exit 0
        fi
    fi

    info "Restoring from backup..."

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would restore from: $latest_backup"
        exit 0
    fi

    # Extract backup
    (cd "$CLAUDE_DIR" && tar -xzf "$latest_backup") || {
        error "Failed to extract backup"
        exit 1
    }

    success "Configuration restored from backup"
    info "Backup file: $latest_backup"
    echo ""
    info "Restart Claude Code to apply restored configuration."
    exit 0
}

# =============================================================================
# CLEANUP AND ERROR HANDLING
# =============================================================================

# Cleanup function for error handling
cleanup_on_error() {
    local exit_code=$?

    if [[ $exit_code -ne 0 ]]; then
        echo ""
        error "Setup failed with exit code: $exit_code"

        if [[ -n "$BACKUP_FILE" ]] && [[ -f "$BACKUP_FILE" ]]; then
            echo ""
            warn "A backup was created before changes were made."
            info "To restore: ./setup.sh --rollback"
        fi
    fi
}

trap cleanup_on_error EXIT

# =============================================================================
# INSTALLATION FUNCTIONS
# =============================================================================

# Create directory structure
create_directories() {
    info "Creating directory structure..."

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would create directories in: $CLAUDE_DIR"
        return 0
    fi

    local dirs=(
        "${CLAUDE_DIR}/scripts"
        "${CLAUDE_DIR}/agents"
        "${CLAUDE_DIR}/commands"
        "${CLAUDE_DIR}/skills"
        "${CLAUDE_DIR}/handoffs"
        "${CLAUDE_DIR}/learnings"
        "${CLAUDE_DIR}/hooks"
        "${CLAUDE_DIR}/tldr-cache"
        "${CLAUDE_DIR}/backups"
    )

    for dir in "${dirs[@]}"; do
        mkdir -p "$dir"
    done

    progress_ok "Directory structure created"
}

# Clean old configuration files
clean_old_config() {
    info "Cleaning old configuration..."

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would clean old config files"
        return 0
    fi

    local cleaned=0

    # Remove old scripts (will be replaced)
    if [[ -d "${CLAUDE_DIR}/scripts" ]] && [[ "$(ls -A "${CLAUDE_DIR}/scripts" 2>/dev/null)" ]]; then
        rm -f "${CLAUDE_DIR}/scripts/"*.sh 2>/dev/null && cleaned=$((cleaned + 1))
    fi

    # Remove old agents (will be replaced)
    if [[ -d "${CLAUDE_DIR}/agents" ]] && [[ "$(ls -A "${CLAUDE_DIR}/agents" 2>/dev/null)" ]]; then
        rm -f "${CLAUDE_DIR}/agents/"*.md 2>/dev/null && cleaned=$((cleaned + 1))
    fi

    # Remove old commands (will be replaced)
    if [[ -d "${CLAUDE_DIR}/commands" ]] && [[ "$(ls -A "${CLAUDE_DIR}/commands" 2>/dev/null)" ]]; then
        rm -f "${CLAUDE_DIR}/commands/"*.md 2>/dev/null && cleaned=$((cleaned + 1))
    fi

    # Remove old skills (will be replaced)
    if [[ -d "${CLAUDE_DIR}/skills" ]] && [[ "$(ls -A "${CLAUDE_DIR}/skills" 2>/dev/null)" ]]; then
        rm -f "${CLAUDE_DIR}/skills/"*.json 2>/dev/null
        rm -f "${CLAUDE_DIR}/skills/"*.md 2>/dev/null && cleaned=$((cleaned + 1))
    fi

    # Remove old hooks docs (will be replaced)
    if [[ -d "${CLAUDE_DIR}/hooks" ]] && [[ "$(ls -A "${CLAUDE_DIR}/hooks" 2>/dev/null)" ]]; then
        rm -f "${CLAUDE_DIR}/hooks/"*.md 2>/dev/null && cleaned=$((cleaned + 1))
    fi

    # Remove old cache files
    rm -f "${CLAUDE_DIR}/skill-rules.cache" 2>/dev/null
    rm -f "${CLAUDE_DIR}/skill-activation.out" 2>/dev/null

    # Remove old CLAUDE.md (will be replaced)
    rm -f "${CLAUDE_DIR}/CLAUDE.md" 2>/dev/null

    if [[ $cleaned -gt 0 ]]; then
        progress_ok "Cleaned old configuration ($cleaned areas)"
    else
        progress_ok "No old configuration to clean (fresh install)"
    fi
}

# Copy configuration files
install_config_files() {
    info "Installing configuration files..."

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would install config files from: $SCRIPT_DIR"
        return 0
    fi

    # Copy CLAUDE.md
    if [[ -f "${SCRIPT_DIR}/CLAUDE.md" ]]; then
        cp "${SCRIPT_DIR}/CLAUDE.md" "${CLAUDE_DIR}/"
        progress_ok "CLAUDE.md (coding standards)"
    fi

    # Copy scripts
    if [[ -d "${SCRIPT_DIR}/scripts" ]]; then
        cp -r "${SCRIPT_DIR}/scripts/"* "${CLAUDE_DIR}/scripts/" 2>/dev/null || true
        chmod +x "${CLAUDE_DIR}/scripts/"*.sh 2>/dev/null || true
        progress_ok "scripts/ (hook commands)"
    fi

    # Copy agents
    if [[ -d "${SCRIPT_DIR}/agents" ]]; then
        cp -r "${SCRIPT_DIR}/agents/"* "${CLAUDE_DIR}/agents/" 2>/dev/null || true
        local agent_count
        agent_count=$(find "${SCRIPT_DIR}/agents" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
        progress_ok "agents/ ($agent_count agents)"
    fi

    # Copy commands
    if [[ -d "${SCRIPT_DIR}/commands" ]]; then
        cp -r "${SCRIPT_DIR}/commands/"* "${CLAUDE_DIR}/commands/" 2>/dev/null || true
        local cmd_count
        cmd_count=$(find "${SCRIPT_DIR}/commands" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
        progress_ok "commands/ ($cmd_count commands)"
    fi

    # Copy skills
    if [[ -d "${SCRIPT_DIR}/skills" ]]; then
        cp -r "${SCRIPT_DIR}/skills/"* "${CLAUDE_DIR}/skills/" 2>/dev/null || true
        progress_ok "skills/ (skill activation rules)"
    fi

    # Copy hooks docs
    if [[ -d "${SCRIPT_DIR}/hooks" ]]; then
        cp -r "${SCRIPT_DIR}/hooks/"* "${CLAUDE_DIR}/hooks/" 2>/dev/null || true
        progress_ok "hooks/ (behavioral guidelines)"
    fi
}

# Handle settings.json with MCP preservation
install_settings() {
    info "Installing settings.json..."

    local team_settings="${SCRIPT_DIR}/settings.json"
    local existing_settings="${CLAUDE_DIR}/settings.json"
    local output_settings="${CLAUDE_DIR}/settings.json"

    if [[ ! -f "$team_settings" ]]; then
        error "Team settings.json not found: $team_settings"
        return 1
    fi

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would install settings.json"
        if [[ "$PRESERVE_MCP" == true ]] && [[ -f "$existing_settings" ]]; then
            info "[DRY RUN] Would check for custom MCP servers to preserve"
        fi
        return 0
    fi

    # Handle MCP preservation
    handle_mcp_preservation "$existing_settings" "$team_settings" "$output_settings"

    progress_ok "settings.json (permissions + hooks)"
}

# =============================================================================
# DEPENDENCY INSTALLATION
# =============================================================================

install_dependencies() {
    header "Checking Dependencies"

    # Initialize platform detection
    detect_platform
    info "Platform: $OS ($OS_VERSION) [$ARCH]"
    echo ""

    # Detect package managers
    detect_package_managers
    if [[ -n "$PM_SYSTEM" ]]; then
        progress_ok "System package manager: $PM_SYSTEM"
    else
        progress_warn "No system package manager detected"
    fi
    if [[ -n "$PM_NODE" ]]; then
        progress_ok "Node.js package manager: $PM_NODE"
    else
        progress_warn "No Node.js runtime detected"
    fi
    echo ""

    # Required: git
    info "Required dependencies:"
    if has_command git; then
        progress_ok "git"
    else
        progress_fail "git is required but not installed"
        error "Please install git and re-run setup"
        exit 1
    fi

    # Required: jq (for MCP handling, learnings, statusline)
    if ! has_command jq; then
        progress_warn "jq not found (required for MCP handling & learnings)"
        ensure_system_package jq || {
            echo ""
            warn "Could not auto-install jq. Please install manually:"
            echo "    $(get_install_hint jq)"
            echo ""
        }
    else
        progress_ok "jq"
    fi

    # Node.js runtime check
    if [[ -z "$PM_NODE" ]]; then
        progress_warn "npm/bun not found (required for MCP servers)"
        echo "    Please install Node.js: https://nodejs.org"
        echo "    Or Bun: https://bun.sh"
    fi

    # Skip optional deps if minimal mode
    if [[ "$MINIMAL" == true ]]; then
        echo ""
        info "Skipping optional dependencies (--minimal mode)"
        return 0
    fi

    echo ""
    info "Optional dependencies:"

    # pipx (for Python CLI tools)
    ensure_pipx

    # agent-browser
    if ! has_command agent-browser; then
        progress_warn "agent-browser not found (AI browser automation)"
        ensure_npm_global agent-browser || {
            echo "    Install manually: npm i -g agent-browser"
        }
    else
        progress_ok "agent-browser"
    fi

    # llm-tldr
    if ! has_command tldr && ! has_command tldr-mcp; then
        progress_warn "llm-tldr not found (semantic code analysis)"
        ensure_python_package llm-tldr tldr || {
            echo "    Install manually: pipx install llm-tldr"
        }
    else
        progress_ok "llm-tldr"
    fi
}

# =============================================================================
# SUMMARY AND VERIFICATION
# =============================================================================

show_feature_summary() {
    header "Features Enabled"

    # Core features (always available)
    box_start "Core Features"
    box_line "ok" "Skill Activation (19 skills)"
    box_line "ok" "Agent Routing (9 agents)"
    box_line "ok" "Session Handoffs (auto-save)"
    box_line "ok" "Persistent Learnings (/learn)"

    # jq-dependent features
    if has_command jq; then
        box_line "ok" "Custom Statusline"
    else
        box_line "warn" "Statusline (install jq)"
    fi

    # agent-browser
    if has_command agent-browser; then
        box_line "ok" "Browser Automation (agent-browser)"
    else
        box_line "warn" "Browser Automation (npm i -g agent-browser)"
    fi

    # tldr
    if has_command tldr || has_command tldr-mcp; then
        box_line "ok" "Semantic Code Search (tldr)"
    else
        box_line "warn" "Semantic Search (pipx install llm-tldr)"
    fi

    box_end

    # MCP Servers summary
    if [[ -f "${CLAUDE_DIR}/settings.json" ]]; then
        echo ""
        show_mcp_summary "${CLAUDE_DIR}/settings.json"
    fi
}

verify_installation() {
    info "Verifying installation..."

    local errors=0

    # Check critical files exist
    if [[ ! -f "${CLAUDE_DIR}/settings.json" ]]; then
        progress_fail "settings.json missing"
        errors=$((errors + 1))
    else
        progress_ok "settings.json"
    fi

    if [[ ! -f "${CLAUDE_DIR}/CLAUDE.md" ]]; then
        progress_fail "CLAUDE.md missing"
        errors=$((errors + 1))
    else
        progress_ok "CLAUDE.md"
    fi

    # Check scripts are executable
    if [[ -d "${CLAUDE_DIR}/scripts" ]]; then
        local script_count
        script_count=$(find "${CLAUDE_DIR}/scripts" -name "*.sh" -type f 2>/dev/null | wc -l | tr -d ' ')
        if [[ "$script_count" -gt 0 ]]; then
            progress_ok "scripts/ ($script_count scripts)"
        else
            progress_warn "No scripts found"
        fi
    fi

    if [[ $errors -gt 0 ]]; then
        return 1
    fi
    return 0
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    # Parse command line arguments
    parse_args "$@"

    # Handle rollback mode
    if [[ "$DO_ROLLBACK" == true ]]; then
        do_rollback
        exit 0
    fi

    # Show banner
    show_banner "$VERSION"

    # Dry run notice
    if [[ "$DRY_RUN" == true ]]; then
        warn "DRY RUN MODE - No changes will be made"
        echo ""
    fi

    # Install dependencies first (need jq for MCP handling)
    install_dependencies

    # Create backup before making changes
    echo ""
    create_backup

    # Create directories
    echo ""
    create_directories

    # Clean old config
    clean_old_config

    # Install config files
    echo ""
    install_config_files

    # Handle settings.json with MCP preservation
    echo ""
    install_settings

    # Verify installation
    echo ""
    if verify_installation; then
        show_success_banner
    else
        warn "Installation completed with warnings"
    fi

    # Show feature summary
    show_feature_summary

    echo ""
    echo "Installed to: ${CYAN}~/.claude/${RESET}"
    echo ""
    info "Just describe what you want naturally!"
    info "The skill activation system suggests relevant skills, workflows, and agents."
    echo ""

    if [[ -n "$BACKUP_FILE" ]]; then
        info "Backup saved to: $BACKUP_FILE"
        info "To restore: ./setup.sh --rollback"
        echo ""
    fi

    success "Restart Claude Code to apply changes."
    echo ""
}

# Run main function
main "$@"
