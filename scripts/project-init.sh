#!/usr/bin/env bash
set -euo pipefail

# project-init.sh — Set up cross-tool AI config in a project directory
# Copies AGENTS.md and creates tool-specific pointer files so every AI
# coding tool (Claude Code, Codex, Cursor, Copilot, Windsurf) reads the
# same standards.
#
# Usage:
#   project-init.sh [directory]   # defaults to current directory
#   project-init.sh --check       # check if current project is set up
#   project-init.sh --update      # force-update AGENTS.md to latest version

CLAUDE_DIR="${HOME}/.claude"
SOURCE_AGENTS="${CLAUDE_DIR}/AGENTS.md"
VERSION_FILE="${CLAUDE_DIR}/.cc-settings-version"
PROJECT_DIR="${1:-.}"

# Colors (source lib if available, fallback to basic)
if [[ -f "${CLAUDE_DIR}/lib/colors.sh" ]]; then
    source "${CLAUDE_DIR}/lib/colors.sh"
else
    GREEN='\033[0;32m' YELLOW='\033[1;33m' BLUE='\033[0;34m'
    CYAN='\033[0;36m' DIM='\033[2m' RESET='\033[0m'
    info() { echo -e "${BLUE}i${RESET} $*"; }
    success() { echo -e "${GREEN}ok${RESET} $*"; }
    warn() { echo -e "${YELLOW}!${RESET} $*"; }
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

installed_version() {
    if [[ -f "$VERSION_FILE" ]]; then
        jq -r '.version // "unknown"' "$VERSION_FILE" 2>/dev/null || echo "unknown"
    else
        echo "unknown"
    fi
}

# Read the version header from a project's AGENTS.md (line 2 comment)
project_agents_version() {
    local file="$1"
    if [[ -f "$file" ]]; then
        # Look for <!-- cc-settings vX.X --> header
        local header
        header=$(head -1 "$file" 2>/dev/null)
        if [[ "$header" =~ cc-settings\ v([0-9.]+) ]]; then
            echo "${BASH_REMATCH[1]}"
            return
        fi
    fi
    echo ""
}

# Check if a file is managed by cc-settings (has our header)
is_managed() {
    local file="$1"
    [[ -f "$file" ]] && head -1 "$file" 2>/dev/null | grep -q "cc-settings" 2>/dev/null
}

# Stamp AGENTS.md with version header before copying
stamp_agents() {
    local version
    version=$(installed_version)
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Prepend version header, then the real content
    {
        echo "<!-- cc-settings v${version} | ${timestamp} | DO NOT EDIT — managed by cc-settings -->"
        cat "$SOURCE_AGENTS"
    }
}

# ---------------------------------------------------------------------------
# Cross-tool pointer files
# ---------------------------------------------------------------------------

# GitHub Copilot instructions (points to AGENTS.md)
create_copilot_instructions() {
    local dir="$1"
    local file="${dir}/.github/copilot-instructions.md"

    # Don't touch if it exists and isn't ours
    if [[ -f "$file" ]] && ! is_managed "$file"; then
        info "Skipping .github/copilot-instructions.md (custom file exists)"
        return
    fi

    mkdir -p "${dir}/.github"
    cat > "$file" << 'COPILOT'
<!-- cc-settings — DO NOT EDIT — managed by cc-settings -->
<!-- GitHub Copilot: read AGENTS.md in the repository root for full coding standards -->

Follow the coding standards and guardrails defined in `AGENTS.md` at the repository root.
That file is the single source of truth for all AI-assisted development on this project.
COPILOT
    success ".github/copilot-instructions.md"
}

# Cursor rules (points to AGENTS.md)
create_cursor_rules() {
    local dir="$1"
    local file="${dir}/.cursorrules"

    if [[ -f "$file" ]] && ! is_managed "$file"; then
        info "Skipping .cursorrules (custom file exists)"
        return
    fi

    cat > "$file" << 'CURSOR'
<!-- cc-settings — DO NOT EDIT — managed by cc-settings -->
Read and follow AGENTS.md in the repository root for all coding standards and guardrails.
AGENTS.md is the single source of truth for this project.
CURSOR
    success ".cursorrules"
}

# Windsurf rules (points to AGENTS.md)
create_windsurf_rules() {
    local dir="$1"
    local file="${dir}/.windsurfrules"

    if [[ -f "$file" ]] && ! is_managed "$file"; then
        info "Skipping .windsurfrules (custom file exists)"
        return
    fi

    cat > "$file" << 'WINDSURF'
<!-- cc-settings — DO NOT EDIT — managed by cc-settings -->
Read and follow AGENTS.md in the repository root for all coding standards and guardrails.
AGENTS.md is the single source of truth for this project.
WINDSURF
    success ".windsurfrules"
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_check() {
    local dir
    dir=$(cd "$PROJECT_DIR" && pwd)
    local agents="${dir}/AGENTS.md"
    local version
    version=$(installed_version)
    local proj_version
    proj_version=$(project_agents_version "$agents")

    echo ""
    info "Project: $(basename "$dir")"
    echo ""

    if [[ ! -f "$agents" ]]; then
        warn "AGENTS.md not found — run: project-init.sh"
    elif [[ -z "$proj_version" ]]; then
        info "AGENTS.md exists (not managed by cc-settings)"
    elif [[ "$proj_version" == "$version" ]]; then
        success "AGENTS.md is up to date (v${version})"
    else
        warn "AGENTS.md is v${proj_version}, installed is v${version} — run: project-init.sh --update"
    fi

    for file in ".github/copilot-instructions.md" ".cursorrules" ".windsurfrules"; do
        if [[ -f "${dir}/${file}" ]]; then
            if is_managed "${dir}/${file}"; then
                success "${file} (managed)"
            else
                info "${file} (custom)"
            fi
        else
            echo -e "  ${DIM}-${RESET} ${file} (not set up)"
        fi
    done
    echo ""
}

cmd_update() {
    local dir
    dir=$(cd "$PROJECT_DIR" && pwd)
    local agents="${dir}/AGENTS.md"

    if [[ ! -f "$SOURCE_AGENTS" ]]; then
        warn "cc-settings not installed — run setup.sh first"
        exit 1
    fi

    # AGENTS.md
    if [[ -f "$agents" ]] && ! is_managed "$agents"; then
        warn "AGENTS.md exists but is not managed by cc-settings — skipping"
        warn "Delete it first if you want cc-settings to manage it"
    else
        stamp_agents > "$agents"
        success "AGENTS.md (v$(installed_version))"
    fi

    # Cross-tool pointer files
    create_copilot_instructions "$dir"
    create_cursor_rules "$dir"
    create_windsurf_rules "$dir"
}

cmd_init() {
    local dir
    dir=$(cd "$PROJECT_DIR" && pwd)
    local agents="${dir}/AGENTS.md"

    echo ""
    info "Setting up cross-tool AI config in: $(basename "$dir")"
    echo ""

    if [[ ! -f "$SOURCE_AGENTS" ]]; then
        warn "cc-settings not installed — run setup.sh first"
        exit 1
    fi

    # AGENTS.md — the universal standard
    if [[ -f "$agents" ]] && ! is_managed "$agents"; then
        info "AGENTS.md already exists (not managed by cc-settings) — keeping yours"
    else
        stamp_agents > "$agents"
        success "AGENTS.md (v$(installed_version))"
    fi

    # Cross-tool pointers
    create_copilot_instructions "$dir"
    create_cursor_rules "$dir"
    create_windsurf_rules "$dir"

    echo ""
    success "Cross-tool AI config ready. Commit these files to share with your team."
    echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

case "${1:-}" in
    --check)  cmd_check ;;
    --update) cmd_update ;;
    --help|-h)
        echo "Usage: project-init.sh [directory|--check|--update]"
        echo ""
        echo "Commands:"
        echo "  (default)    Set up AGENTS.md + cross-tool config in directory"
        echo "  --check      Check if project is set up and versions match"
        echo "  --update     Force-update AGENTS.md to latest installed version"
        echo ""
        echo "Files created:"
        echo "  AGENTS.md                          Universal AI coding standards"
        echo "  .github/copilot-instructions.md    GitHub Copilot pointer"
        echo "  .cursorrules                       Cursor pointer"
        echo "  .windsurfrules                     Windsurf pointer"
        ;;
    *)        cmd_init ;;
esac
