#!/bin/bash
# Post-Edit Hook
# Runs after Write or Edit operations

# Auto-format with biome if available
if command -v biome &> /dev/null; then
    biome check --write --unsafe "$TOOL_INPUT_FILE" 2>/dev/null || true
fi

# Log the edit
echo "$(date '+%Y-%m-%d %H:%M:%S') - Edited: ${TOOL_INPUT_FILE:-unknown}" >> ~/.claude/edits.log
