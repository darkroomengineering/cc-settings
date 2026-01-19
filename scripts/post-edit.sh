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
