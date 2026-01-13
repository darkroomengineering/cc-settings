#!/bin/bash
# Post-Edit Hook - Auto-format with biome for supported files

FILE_PATH="${TOOL_INPUT_path:-}"

# Skip if no file path or biome not available
[ -z "$FILE_PATH" ] && exit 0
command -v biome &>/dev/null || exit 0

# Only format supported file types
case "$FILE_PATH" in
    *.ts|*.tsx|*.js|*.jsx|*.json|*.css)
        biome check --write "$FILE_PATH" 2>/dev/null || true
        ;;
esac
