#!/bin/bash
# Darkroom Claude Code Setup Script
# Installs team configuration with REAL hooks and skill activation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
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
echo "║   Darkroom Claude Code Setup v4.1        ║"
echo "║   With Skill Activation System           ║"
echo "╚══════════════════════════════════════════╝"
echo ""

mkdir -p "$CLAUDE_DIR"
mkdir -p "$CLAUDE_DIR/scripts"
mkdir -p "$CLAUDE_DIR/agents"
mkdir -p "$CLAUDE_DIR/commands"
mkdir -p "$CLAUDE_DIR/skills"
mkdir -p "$CLAUDE_DIR/handoffs"
mkdir -p "$CLAUDE_DIR/learnings"

# Backup existing config
if [ -f "$CLAUDE_DIR/settings.json" ]; then
    BACKUP_FILE="$CLAUDE_DIR/settings.json.backup.$(date +%Y%m%d%H%M%S)"
    echo "💾 Backing up existing settings.json"
    cp "$CLAUDE_DIR/settings.json" "$BACKUP_FILE"
fi

echo ""
echo "📦 Installing configuration..."
echo ""

# Copy CLAUDE.md
if [ -f "$SCRIPT_DIR/CLAUDE.md" ]; then
    cp "$SCRIPT_DIR/CLAUDE.md" "$CLAUDE_DIR/"
    echo "  ✓ CLAUDE.md (coding standards)"
fi

# Copy settings.json (with real hooks!)
if [ -f "$SCRIPT_DIR/settings.json" ]; then
    cp "$SCRIPT_DIR/settings.json" "$CLAUDE_DIR/"
    echo "  ✓ settings.json (permissions + hooks)"
fi

# Copy and setup hook scripts
if [ -d "$SCRIPT_DIR/scripts" ]; then
    cp -r "$SCRIPT_DIR/scripts/"* "$CLAUDE_DIR/scripts/"
    chmod +x "$CLAUDE_DIR/scripts/"*.sh 2>/dev/null || true
    echo "  ✓ scripts/ (hook commands)"
fi

# Copy agents
if [ -d "$SCRIPT_DIR/agents" ]; then
    cp -r "$SCRIPT_DIR/agents/"* "$CLAUDE_DIR/agents/"
    AGENT_COUNT=$(ls -1 "$SCRIPT_DIR/agents/"*.md 2>/dev/null | wc -l | tr -d ' ')
    echo "  ✓ agents/ ($AGENT_COUNT agents)"
fi

# Copy commands
if [ -d "$SCRIPT_DIR/commands" ]; then
    cp -r "$SCRIPT_DIR/commands/"* "$CLAUDE_DIR/commands/"
    CMD_COUNT=$(ls -1 "$SCRIPT_DIR/commands/"*.md 2>/dev/null | wc -l | tr -d ' ')
    echo "  ✓ commands/ ($CMD_COUNT commands)"
fi

# Copy skills
if [ -d "$SCRIPT_DIR/skills" ]; then
    cp -r "$SCRIPT_DIR/skills/"* "$CLAUDE_DIR/skills/"
    echo "  ✓ skills/ (skill activation rules)"
fi

# Copy hooks documentation
if [ -d "$SCRIPT_DIR/hooks" ]; then
    cp -r "$SCRIPT_DIR/hooks/"* "$CLAUDE_DIR/hooks/" 2>/dev/null || mkdir -p "$CLAUDE_DIR/hooks" && cp -r "$SCRIPT_DIR/hooks/"* "$CLAUDE_DIR/hooks/"
    echo "  ✓ hooks/ (behavioral guidelines)"
fi

# Install llm-tldr (optional)
if [ "$INSTALL_TLDR" = true ]; then
    echo ""
    
    # Check if already installed
    if command -v tldr-mcp &> /dev/null; then
        echo "📦 llm-tldr already installed"
        echo "  ✓ tldr-mcp available for MCP integration"
    elif command -v pip &> /dev/null || command -v pip3 &> /dev/null; then
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
        echo "  ⚠ pip not found - install manually: pipx install llm-tldr"
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

if [ "$INSTALL_TLDR" = true ] && command -v tldr &> /dev/null; then
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
