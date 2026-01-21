#!/bin/bash
# Post-Edit Hook - Auto-format, auto-review, and visual QA

FILE_PATH="${TOOL_INPUT_path:-}"

[ -z "$FILE_PATH" ] && exit 0

# Auto-format with biome
if command -v biome &>/dev/null; then
    case "$FILE_PATH" in
        *.ts|*.tsx|*.js|*.jsx|*.json|*.css)
            biome check --write "$FILE_PATH" 2>/dev/null || true
            ;;
    esac
fi

# Console.log warning detection for JS/TS files
check_console_logs() {
    local file="$1"

    # Only check JS/TS files
    case "$file" in
        *.ts|*.tsx|*.js|*.jsx) ;;
        *) return 0 ;;
    esac

    # Check if file exists and is readable
    [ -r "$file" ] || return 0

    # Find console.log statements with line numbers
    local matches
    matches=$(grep -n 'console\.log' "$file" 2>/dev/null)

    if [ -n "$matches" ]; then
        echo "" >&2
        echo "[Hook] console.log found in $file" >&2
        while IFS= read -r line; do
            local line_num="${line%%:*}"
            local content="${line#*:}"
            # Trim leading whitespace from content
            content="${content#"${content%%[![:space:]]*}"}"
            echo "  Line $line_num: $content" >&2
        done <<< "$matches"
        echo "[Hook] Remove before committing" >&2
        echo "" >&2
    fi
}

check_console_logs "$FILE_PATH"

# Auto-review + Visual QA reminder for component files
case "$FILE_PATH" in
    *.tsx|*.jsx)
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "🔍 AUTO-REVIEW: $(basename "$FILE_PATH")"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "Code Review:"
        echo "  • A11y: alt, aria-label, semantic elements, keyboard"
        echo "  • UI: Tailwind defaults, animations (transform/opacity)"
        echo "  • Perf: barrel imports, waterfalls, memoization"
        echo ""
        echo "Visual QA (if dev server running):"
        echo "  • Run /qa to validate with agent-browser"
        echo "  • Screenshot + accessibility tree analysis"
        echo "  • Touch targets, contrast, layout validation"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        ;;
esac
