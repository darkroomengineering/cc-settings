#!/bin/bash
# PreToolUse Hook - Remind to fetch docs before installing packages
# Triggers on: bun add, npm install, npx add, pnpm add

TOOL_INPUT_CMD="${TOOL_INPUT_command:-}"

[ -z "$TOOL_INPUT_CMD" ] && exit 0

# Check if command is a package install
if echo "$TOOL_INPUT_CMD" | grep -qE '(bun add|npm install|npx add|pnpm add|bun i |npm i )\s'; then
    # Extract package name (rough: first arg after the install command)
    PKG=$(echo "$TOOL_INPUT_CMD" | sed -E 's/.*(bun add|npm install|npx add|pnpm add|bun i|npm i)\s+//' | awk '{print $1}' | sed 's/@[^/]*$//')

    [ -z "$PKG" ] && exit 0

    # Skip flags-only commands (bun add -D, npm install --save-dev, etc.)
    [[ "$PKG" == -* ]] && exit 0

    echo "[Hook] Installing '$PKG' — did you fetch docs first?"
    echo "  Run: /docs $PKG (or use context7 MCP to get latest API docs)"
    echo "  Run: bun info $PKG (to check latest version)"
fi
