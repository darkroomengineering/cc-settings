#!/bin/bash
# Post-Edit TypeScript Check - runs tsc --noEmit for TS/TSX files
# Async hook: reports errors without blocking

FILE_PATH="${TOOL_INPUT_file_path:-}"

[ -z "$FILE_PATH" ] && exit 0

# Only check TypeScript files
case "$FILE_PATH" in
    *.ts|*.tsx) ;;
    *) exit 0 ;;
esac

# Only run if tsconfig exists (TypeScript project)
[ -f "tsconfig.json" ] || exit 0

# Run tsc and filter to only show errors in the edited file
bunx tsc --noEmit 2>&1 | grep -E "$FILE_PATH" || true
