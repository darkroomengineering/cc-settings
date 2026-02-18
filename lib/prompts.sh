#!/bin/bash
# lib/prompts.sh - Interactive CLI prompts
# Part of Darkroom Claude Code Setup
# Compatible with bash 3.2+ (macOS default)

# Global flag for non-interactive mode
INTERACTIVE=true

# Portable lowercase conversion (bash 3.2 compatible)
to_lower() {
    echo "$1" | tr '[:upper:]' '[:lower:]'
}

# Yes/No prompt with default
# Usage: prompt_yn "Question?" [y|n]
# Returns: 0 for yes, 1 for no
prompt_yn() {
    local prompt="$1"
    local default="${2:-y}"
    local default_lower
    default_lower=$(to_lower "$default")

    # Non-interactive mode: return default
    if [[ "$INTERACTIVE" != true ]]; then
        [[ "$default_lower" == "y" ]]
        return $?
    fi

    local hint
    if [[ "$default_lower" == "y" ]]; then
        hint="[Y/n]"
    else
        hint="[y/N]"
    fi

    while true; do
        echo -n "? ${prompt} ${hint} "
        read -r response

        # Empty response: use default
        if [[ -z "$response" ]]; then
            response="$default"
        fi

        local response_lower
        response_lower=$(to_lower "$response")

        case "$response_lower" in
            y|yes)
                return 0
                ;;
            n|no)
                return 1
                ;;
            *)
                echo "  Please enter 'y' or 'n'"
                ;;
        esac
    done
}

