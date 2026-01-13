#!/bin/bash
# Darkroom Claude Code Setup Script
# Installs team configuration with REAL hooks and skill activation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${HOME}/.claude"
INSTALL_TLDR=false

for arg in "$@"; do
    case $arg in
        --with-tldr)
            INSTALL_TLDR=true
            shift
            ;;
    esac
done

echo "╔══════════════════════════════════════════╗"
echo "║   Darkroom Claude Code Setup v4.3        ║"
echo "║   With Skill Activation System           ║"
echo "║   (Idempotent - safe to re-run)          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Pre-flight dependency check
check_dependencies() {
    local missing=()
    local optional_missing=()
    
    # Required
    command -v git &>/dev/null || missing+=("git")
    
    # Optional but recommended
    command -v jq &>/dev/null || optional_missing+=("jq (recommended for learnings)")
    command -v bun &>/dev/null || command -v npm &>/dev/null || optional_missing+=("bun or npm (for MCP servers)")
    
    if [ ${#missing[@]} -gt 0 ]; then
        echo "❌ Missing required dependencies:"
        for dep in "${missing[@]}"; do
            echo "   - $dep"
        done
        echo ""
        echo "Please install them and re-run setup."
        exit 1
    fi
    
    if [ ${#optional_missing[@]} -gt 0 ]; then
        echo "⚠️  Optional dependencies not found:"
        for dep in "${optional_missing[@]}"; do
            echo "   - $dep"
        done
        echo ""
    fi
}

check_dependencies

# Create directories in parallel
echo "📁 Creating directories..."
mkdir -p "${CLAUDE_DIR}/scripts" &
mkdir -p "${CLAUDE_DIR}/agents" &
mkdir -p "${CLAUDE_DIR}/commands" &
mkdir -p "${CLAUDE_DIR}/skills" &
mkdir -p "${CLAUDE_DIR}/handoffs" &
mkdir -p "${CLAUDE_DIR}/learnings" &
mkdir -p "${CLAUDE_DIR}/hooks" &
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
copy_with_status() {
    local src="$1"
    local dst="$2"
    local name="$3"
    if [ -e "$src" ]; then
        cp -r "$src" "$dst" && echo "  ✓ $name"
    fi
}

# Start all copy operations in background
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

# Generate MCP availability report
echo ""
echo "🔌 Checking MCP server availability..."
MCP_STATUS=""

if command -v npx &>/dev/null; then
    MCP_STATUS="${MCP_STATUS}  ✓ context7 (npx available)\n"
else
    MCP_STATUS="${MCP_STATUS}  ⚠ context7 (npx not found - install Node.js)\n"
fi

if command -v tldr-mcp &>/dev/null; then
    MCP_STATUS="${MCP_STATUS}  ✓ tldr (tldr-mcp available)\n"
elif [ "$INSTALL_TLDR" = true ]; then
    MCP_STATUS="${MCP_STATUS}  → tldr (will install)\n"
else
    MCP_STATUS="${MCP_STATUS}  ⚠ tldr (run with --with-tldr or: pipx install llm-tldr)\n"
fi

# Sanity MCP is HTTP-based, always available
MCP_STATUS="${MCP_STATUS}  ✓ Sanity (HTTP MCP - requires OAuth on first use)\n"

echo -e "$MCP_STATUS"

# Install llm-tldr (optional)
if [ "$INSTALL_TLDR" = true ]; then
    echo ""
    
    if command -v tldr-mcp &>/dev/null; then
        echo "📦 llm-tldr already installed"
        echo "  ✓ tldr-mcp available for MCP integration"
    elif command -v pipx &>/dev/null; then
        echo "📦 Installing llm-tldr via pipx..."
        pipx install llm-tldr 2>/dev/null && {
            echo "  ✓ llm-tldr installed"
        } || {
            echo "  ⚠ Failed to install llm-tldr via pipx"
        }
    elif command -v pip &>/dev/null || command -v pip3 &>/dev/null; then
        echo "📦 Installing llm-tldr..."
        PIP_CMD=$(command -v pip3 || command -v pip)
        $PIP_CMD install --user llm-tldr 2>/dev/null && {
            echo "  ✓ llm-tldr installed"
        } || {
            echo "  ⚠ Failed to install llm-tldr"
            echo ""
            echo "  This usually happens on macOS due to faiss-cpu."
            echo "  Install manually with pipx:"
            echo ""
            echo "    brew install pipx"
            echo "    pipx install llm-tldr"
            echo ""
            echo "  Or skip --with-tldr - the rest works without it."
            echo ""
        }
    else
        echo "  ⚠ pip/pipx not found - install manually: pipx install llm-tldr"
    fi
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║           Setup Complete! 🎉             ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "📂 Installed to ~/.claude/"
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│ Skill Activation System                 │"
echo "├─────────────────────────────────────────┤"
echo "│ ✓ UserPromptSubmit → skill-activation   │"
echo "│ ✓ 19 skills with keyword/intent match   │"
echo "│ ✓ Auto-suggest agents & workflows       │"
echo "│ ✓ Context warnings at 70/80/90%         │"
echo "└─────────────────────────────────────────┘"
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│ Native Hooks                            │"
echo "├─────────────────────────────────────────┤"
echo "│ ✓ SessionStart   → session-start.sh    │"
echo "│   └─ Auto-recalls project learnings    │"
echo "│ ✓ PostToolUse    → post-edit.sh        │"
echo "│ ✓ PreCompact     → create-handoff.sh   │"
echo "│ ✓ SessionEnd     → create-handoff.sh   │"
echo "│ ✓ Notification   → notify.sh           │"
echo "└─────────────────────────────────────────┘"
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│ Memory System                           │"
echo "├─────────────────────────────────────────┤"
echo "│ ✓ store-learning.sh   → Save insights  │"
echo "│ ✓ recall-learnings.sh → Query memory   │"
echo "│ ✓ Auto-recall on session start         │"
echo "│ ✓ /learn command for management        │"
echo "└─────────────────────────────────────────┘"
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│ Agents & Commands                       │"
echo "├─────────────────────────────────────────┤"
echo "│ 9 agents     @planner, @reviewer...    │"
echo "│ 14 commands  /component, /learn...     │"
echo "└─────────────────────────────────────────┘"
echo ""
echo "💡 Just describe what you want naturally!"
echo "   The skill activation system will suggest"
echo "   relevant skills, workflows, and agents."
echo ""

if [ "$INSTALL_TLDR" = true ] && command -v tldr &>/dev/null; then
    echo "┌─────────────────────────────────────────┐"
    echo "│ TLDR Code Analysis                      │"
    echo "├─────────────────────────────────────────┤"
    echo "│ Index:    tldr warm /path/to/project    │"
    echo "│ Search:   tldr semantic \"query\" .       │"
    echo "│ Context:  tldr context func --project . │"
    echo "│ Impact:   tldr impact func .            │"
    echo "│ MCP:      ✓ Pre-configured              │"
    echo "└─────────────────────────────────────────┘"
    echo ""
fi

echo "⚡ Restart Claude Code to apply changes."
echo ""
