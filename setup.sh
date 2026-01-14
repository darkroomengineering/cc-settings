#!/bin/bash
# Darkroom Claude Code Setup Script
# Fully standalone - auto-installs all dependencies

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${HOME}/.claude"
MINIMAL=false
SKIP_DEPS=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --minimal)
            MINIMAL=true
            shift
            ;;
        --skip-deps)
            SKIP_DEPS=true
            shift
            ;;
        --help|-h)
            echo "Darkroom Claude Code Setup"
            echo ""
            echo "Usage: setup.sh [options]"
            echo ""
            echo "Options:"
            echo "  --minimal    Skip optional tools (agent-browser, tldr)"
            echo "  --skip-deps  Skip all dependency installation"
            echo "  --help       Show this help message"
            echo ""
            exit 0
            ;;
    esac
done

echo "╔══════════════════════════════════════════╗"
echo "║   Darkroom Claude Code Setup v5.0        ║"
echo "║   Fully Standalone - Auto-Install        ║"
echo "║   (Idempotent - safe to re-run)          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Darwin*)  echo "macos" ;;
        Linux*)   echo "linux" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *)        echo "unknown" ;;
    esac
}

OS=$(detect_os)
echo "🖥️  Detected OS: $OS"
echo ""

# Install a package using the appropriate package manager
install_package() {
    local pkg="$1"
    local name="${2:-$pkg}"

    if [ "$SKIP_DEPS" = true ]; then
        echo "  ⚠ Skipped $name (--skip-deps)"
        return 1
    fi

    case "$OS" in
        macos)
            if command -v brew &>/dev/null; then
                echo "  → Installing $name via Homebrew..."
                brew install "$pkg" 2>/dev/null && return 0
            fi
            ;;
        linux)
            if command -v apt-get &>/dev/null; then
                echo "  → Installing $name via apt..."
                sudo apt-get update -qq && sudo apt-get install -y "$pkg" 2>/dev/null && return 0
            elif command -v dnf &>/dev/null; then
                echo "  → Installing $name via dnf..."
                sudo dnf install -y "$pkg" 2>/dev/null && return 0
            elif command -v pacman &>/dev/null; then
                echo "  → Installing $name via pacman..."
                sudo pacman -S --noconfirm "$pkg" 2>/dev/null && return 0
            fi
            ;;
        windows)
            if command -v choco &>/dev/null; then
                echo "  → Installing $name via Chocolatey..."
                choco install "$pkg" -y 2>/dev/null && return 0
            elif command -v scoop &>/dev/null; then
                echo "  → Installing $name via Scoop..."
                scoop install "$pkg" 2>/dev/null && return 0
            fi
            ;;
    esac

    return 1
}

# Install npm package globally
install_npm_global() {
    local pkg="$1"
    local name="${2:-$pkg}"

    if [ "$SKIP_DEPS" = true ]; then
        echo "  ⚠ Skipped $name (--skip-deps)"
        return 1
    fi

    if command -v bun &>/dev/null; then
        echo "  → Installing $name via bun..."
        bun install -g "$pkg" 2>/dev/null && return 0
    elif command -v npm &>/dev/null; then
        echo "  → Installing $name via npm..."
        npm install -g "$pkg" 2>/dev/null && return 0
    fi

    return 1
}

# Install Python package via pipx or pip
install_python_pkg() {
    local pkg="$1"
    local name="${2:-$pkg}"

    if [ "$SKIP_DEPS" = true ]; then
        echo "  ⚠ Skipped $name (--skip-deps)"
        return 1
    fi

    if command -v pipx &>/dev/null; then
        echo "  → Installing $name via pipx..."
        pipx install "$pkg" 2>/dev/null && return 0
    elif command -v pip3 &>/dev/null; then
        echo "  → Installing $name via pip3..."
        pip3 install --user "$pkg" 2>/dev/null && return 0
    elif command -v pip &>/dev/null; then
        echo "  → Installing $name via pip..."
        pip install --user "$pkg" 2>/dev/null && return 0
    fi

    return 1
}

# Check and install dependencies
echo "📦 Checking dependencies..."
echo ""

# Required: git
if ! command -v git &>/dev/null; then
    echo "❌ git is required but not installed."
    echo "   Please install git and re-run setup."
    exit 1
fi
echo "  ✓ git"

# Required: jq (for learnings, skill activation, statusline)
if ! command -v jq &>/dev/null; then
    echo "  ⚠ jq not found (required for learnings & statusline)"
    if ! install_package jq "jq"; then
        echo ""
        echo "  ⚠ Could not auto-install jq. Please install manually:"
        echo "    macOS:   brew install jq"
        echo "    Linux:   sudo apt install jq"
        echo "    Windows: choco install jq"
        echo ""
    else
        echo "  ✓ jq installed"
    fi
else
    echo "  ✓ jq"
fi

# Required: Node.js/npm (for MCP servers)
if ! command -v npm &>/dev/null && ! command -v bun &>/dev/null; then
    echo "  ⚠ npm/bun not found (required for MCP servers)"
    echo "    Please install Node.js: https://nodejs.org"
else
    if command -v bun &>/dev/null; then
        echo "  ✓ bun"
    else
        echo "  ✓ npm"
    fi
fi

# Optional: agent-browser (AI-optimized browser automation)
if [ "$MINIMAL" = false ]; then
    if ! command -v agent-browser &>/dev/null; then
        echo "  ⚠ agent-browser not found (AI browser automation)"
        if install_npm_global agent-browser "agent-browser"; then
            echo "  ✓ agent-browser installed"
        else
            echo "  ⚠ Install manually: npm i -g agent-browser"
        fi
    else
        echo "  ✓ agent-browser"
    fi
fi

# Optional: pipx (for Python tools)
if [ "$MINIMAL" = false ]; then
    if ! command -v pipx &>/dev/null; then
        echo "  ⚠ pipx not found (recommended for Python tools)"
        if [ "$OS" = "macos" ]; then
            if command -v brew &>/dev/null; then
                echo "  → Installing pipx via Homebrew..."
                brew install pipx 2>/dev/null && pipx ensurepath 2>/dev/null && {
                    echo "  ✓ pipx installed"
                    # Reload PATH
                    export PATH="$HOME/.local/bin:$PATH"
                }
            fi
        elif [ "$OS" = "linux" ]; then
            if command -v apt-get &>/dev/null; then
                echo "  → Installing pipx via apt..."
                sudo apt-get update -qq && sudo apt-get install -y pipx 2>/dev/null && pipx ensurepath 2>/dev/null && {
                    echo "  ✓ pipx installed"
                    export PATH="$HOME/.local/bin:$PATH"
                }
            fi
        fi
    else
        echo "  ✓ pipx"
    fi
fi

# Optional: llm-tldr (semantic code search)
if [ "$MINIMAL" = false ]; then
    if ! command -v tldr &>/dev/null && ! command -v tldr-mcp &>/dev/null; then
        echo "  ⚠ llm-tldr not found (semantic code analysis)"
        if install_python_pkg llm-tldr "llm-tldr"; then
            echo "  ✓ llm-tldr installed"
        else
            echo "  ⚠ Install manually: pipx install llm-tldr"
        fi
    else
        echo "  ✓ llm-tldr"
    fi
fi

echo ""

# Create directories in parallel
echo "📁 Creating directories..."
mkdir -p "${CLAUDE_DIR}/scripts" &
mkdir -p "${CLAUDE_DIR}/agents" &
mkdir -p "${CLAUDE_DIR}/commands" &
mkdir -p "${CLAUDE_DIR}/skills" &
mkdir -p "${CLAUDE_DIR}/handoffs" &
mkdir -p "${CLAUDE_DIR}/learnings" &
mkdir -p "${CLAUDE_DIR}/hooks" &
mkdir -p "${CLAUDE_DIR}/tldr-cache" &
wait
echo "  ✓ Directory structure created"

# Backup existing config
if [ -f "${CLAUDE_DIR}/settings.json" ]; then
    BACKUP_FILE="${CLAUDE_DIR}/settings.json.backup.$(date +%Y%m%d%H%M%S)"
    echo "💾 Backing up existing settings.json"
    cp "${CLAUDE_DIR}/settings.json" "$BACKUP_FILE"
fi

# Clean old configuration files (preserves user data: learnings, handoffs, logs)
echo ""
echo "🧹 Cleaning old configuration..."
CLEANED=0

# Remove old scripts (will be replaced)
if [ -d "${CLAUDE_DIR}/scripts" ] && [ "$(ls -A ${CLAUDE_DIR}/scripts 2>/dev/null)" ]; then
    rm -f "${CLAUDE_DIR}/scripts/"*.sh 2>/dev/null && ((CLEANED++))
fi

# Remove old agents (will be replaced)
if [ -d "${CLAUDE_DIR}/agents" ] && [ "$(ls -A ${CLAUDE_DIR}/agents 2>/dev/null)" ]; then
    rm -f "${CLAUDE_DIR}/agents/"*.md 2>/dev/null && ((CLEANED++))
fi

# Remove old commands (will be replaced)
if [ -d "${CLAUDE_DIR}/commands" ] && [ "$(ls -A ${CLAUDE_DIR}/commands 2>/dev/null)" ]; then
    rm -f "${CLAUDE_DIR}/commands/"*.md 2>/dev/null && ((CLEANED++))
fi

# Remove old skills (will be replaced)
if [ -d "${CLAUDE_DIR}/skills" ] && [ "$(ls -A ${CLAUDE_DIR}/skills 2>/dev/null)" ]; then
    rm -f "${CLAUDE_DIR}/skills/"*.json 2>/dev/null
    rm -f "${CLAUDE_DIR}/skills/"*.md 2>/dev/null && ((CLEANED++))
fi

# Remove old hooks docs (will be replaced)
if [ -d "${CLAUDE_DIR}/hooks" ] && [ "$(ls -A ${CLAUDE_DIR}/hooks 2>/dev/null)" ]; then
    rm -f "${CLAUDE_DIR}/hooks/"*.md 2>/dev/null && ((CLEANED++))
fi

# Remove old cache files
rm -f "${CLAUDE_DIR}/skill-rules.cache" 2>/dev/null
rm -f "${CLAUDE_DIR}/skill-activation.out" 2>/dev/null

# Remove old settings.json (backup already made)
rm -f "${CLAUDE_DIR}/settings.json" 2>/dev/null
rm -f "${CLAUDE_DIR}/CLAUDE.md" 2>/dev/null

if [ $CLEANED -gt 0 ]; then
    echo "  ✓ Cleaned old configuration ($CLEANED directories)"
else
    echo "  ✓ No old configuration to clean (fresh install)"
fi

echo ""
echo "📦 Installing configuration..."
echo ""

# Copy files in parallel using background jobs
[ -f "${SCRIPT_DIR}/CLAUDE.md" ] && cp "${SCRIPT_DIR}/CLAUDE.md" "${CLAUDE_DIR}/" &
PID_CLAUDE=$!

[ -f "${SCRIPT_DIR}/settings.json" ] && cp "${SCRIPT_DIR}/settings.json" "${CLAUDE_DIR}/" &
PID_SETTINGS=$!

[ -d "${SCRIPT_DIR}/scripts" ] && cp -r "${SCRIPT_DIR}/scripts/"* "${CLAUDE_DIR}/scripts/" &
PID_SCRIPTS=$!

[ -d "${SCRIPT_DIR}/agents" ] && cp -r "${SCRIPT_DIR}/agents/"* "${CLAUDE_DIR}/agents/" &
PID_AGENTS=$!

[ -d "${SCRIPT_DIR}/commands" ] && cp -r "${SCRIPT_DIR}/commands/"* "${CLAUDE_DIR}/commands/" &
PID_COMMANDS=$!

[ -d "${SCRIPT_DIR}/skills" ] && cp -r "${SCRIPT_DIR}/skills/"* "${CLAUDE_DIR}/skills/" &
PID_SKILLS=$!

[ -d "${SCRIPT_DIR}/hooks" ] && cp -r "${SCRIPT_DIR}/hooks/"* "${CLAUDE_DIR}/hooks/" &
PID_HOOKS=$!

# Wait for all copies and report status
wait $PID_CLAUDE 2>/dev/null && echo "  ✓ CLAUDE.md (coding standards)"
wait $PID_SETTINGS 2>/dev/null && echo "  ✓ settings.json (permissions + hooks)"
wait $PID_SCRIPTS 2>/dev/null && echo "  ✓ scripts/ (hook commands)"
wait $PID_AGENTS 2>/dev/null && {
    AGENT_COUNT=$(find "${SCRIPT_DIR}/agents" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    echo "  ✓ agents/ ($AGENT_COUNT agents)"
}
wait $PID_COMMANDS 2>/dev/null && {
    CMD_COUNT=$(find "${SCRIPT_DIR}/commands" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    echo "  ✓ commands/ ($CMD_COUNT commands)"
}
wait $PID_SKILLS 2>/dev/null && echo "  ✓ skills/ (skill activation rules)"
wait $PID_HOOKS 2>/dev/null && echo "  ✓ hooks/ (behavioral guidelines)"

# Make scripts executable
chmod +x "${CLAUDE_DIR}/scripts/"*.sh 2>/dev/null || true

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║           Setup Complete! 🎉             ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "📂 Installed to ~/.claude/"
echo ""

# Feature summary based on what's installed
echo "┌─────────────────────────────────────────┐"
echo "│ Features Enabled                        │"
echo "├─────────────────────────────────────────┤"

# Core features (always available)
echo "│ ✓ Skill Activation (19 skills)         │"
echo "│ ✓ Agent Routing (9 agents)             │"
echo "│ ✓ Session Handoffs (auto-save)         │"
echo "│ ✓ Persistent Learnings (/learn)        │"

# jq-dependent features
if command -v jq &>/dev/null; then
    echo "│ ✓ Custom Statusline                    │"
else
    echo "│ ⚠ Statusline (install jq)              │"
fi

# agent-browser
if command -v agent-browser &>/dev/null; then
    echo "│ ✓ Browser Automation (agent-browser)   │"
else
    echo "│ ⚠ Browser Automation (npm i -g agent-browser) │"
fi

# tldr
if command -v tldr &>/dev/null || command -v tldr-mcp &>/dev/null; then
    echo "│ ✓ Semantic Code Search (tldr)          │"
    echo "│   Auto-warms on session start          │"
else
    echo "│ ⚠ Semantic Search (pipx install llm-tldr) │"
fi

echo "└─────────────────────────────────────────┘"
echo ""

# MCP Servers
echo "┌─────────────────────────────────────────┐"
echo "│ MCP Servers                             │"
echo "├─────────────────────────────────────────┤"
echo "│ ✓ context7   - Library docs lookup      │"
echo "│ ✓ Sanity     - CMS operations (OAuth)   │"
if command -v tldr-mcp &>/dev/null; then
    echo "│ ✓ tldr       - Semantic code analysis   │"
else
    echo "│ ⚠ tldr       - Install llm-tldr         │"
fi
echo "└─────────────────────────────────────────┘"
echo ""

echo "💡 Just describe what you want naturally!"
echo "   The skill activation system suggests"
echo "   relevant skills, workflows, and agents."
echo ""
echo "⚡ Restart Claude Code to apply changes."
echo ""
