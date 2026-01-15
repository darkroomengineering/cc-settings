#!/bin/bash
# lib/prompts.sh - Interactive CLI prompts
# Part of Darkroom Claude Code Setup
# Compatible with bash 3.2+ (macOS default)

# Global flag for non-interactive mode
INTERACTIVE=true

# Disable all prompts (use defaults)
disable_prompts() {
    INTERACTIVE=false
}

# Enable prompts
enable_prompts() {
    INTERACTIVE=true
}

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

# Single selection menu
# Usage: prompt_select "prompt" "option1" "option2" "option3"
# Returns: selected index (0-based) in $REPLY
prompt_select() {
    local prompt="$1"
    shift
    local options=("$@")
    local num_options=${#options[@]}

    # Non-interactive mode: return first option
    if [[ "$INTERACTIVE" != true ]]; then
        REPLY=0
        echo "${options[0]}"
        return 0
    fi

    echo ""
    echo "? ${prompt}"
    echo ""

    local i
    for i in "${!options[@]}"; do
        printf "  %d. %s\n" "$((i + 1))" "${options[$i]}"
    done

    echo ""

    while true; do
        echo -n "  Enter number (1-${num_options}): "
        read -r choice

        if [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 ]] && [[ "$choice" -le "$num_options" ]]; then
            REPLY=$((choice - 1))
            echo "  -> ${options[$REPLY]}"
            return 0
        else
            echo "  Enter a number between 1 and ${num_options}"
        fi
    done
}

# Multiple selection menu (simple text-based)
# Usage: prompt_multiselect "prompt" "option1" "option2" "option3"
# Sets: SELECTED_ITEMS array with selected options
# Sets: SELECTED_INDICES array with selected indices (0-based)
# Returns: 0 on confirm, 1 on cancel
declare -a SELECTED_ITEMS=()
declare -a SELECTED_INDICES=()

prompt_multiselect() {
    local prompt="$1"
    shift
    local options=("$@")
    local num_options=${#options[@]}

    # Initialize selection state (all selected by default)
    local -a selected=()
    local i
    for i in "${!options[@]}"; do
        selected[$i]=true
    done

    # Non-interactive mode: select all
    if [[ "$INTERACTIVE" != true ]]; then
        SELECTED_ITEMS=("${options[@]}")
        SELECTED_INDICES=()
        for i in "${!options[@]}"; do
            SELECTED_INDICES+=("$i")
        done
        return 0
    fi

    echo ""
    echo "? ${prompt}"

    while true; do
        echo ""
        echo "  Current selection:"
        # Display options with checkboxes
        for i in "${!options[@]}"; do
            local checkbox
            if [[ "${selected[$i]}" == true ]]; then
                checkbox="[x]"
            else
                checkbox="[ ]"
            fi
            printf "  %s %d. %s\n" "$checkbox" "$((i + 1))" "${options[$i]}"
        done

        echo ""
        echo "  Commands: <number>=toggle, a=all, x=none, q=cancel, Enter=done"
        echo -n "  > "
        read -r input

        case "$input" in
            "")
                # Confirm selection
                SELECTED_ITEMS=()
                SELECTED_INDICES=()
                for i in "${!options[@]}"; do
                    if [[ "${selected[$i]}" == true ]]; then
                        SELECTED_ITEMS+=("${options[$i]}")
                        SELECTED_INDICES+=("$i")
                    fi
                done
                echo "  -> Selected ${#SELECTED_ITEMS[@]} item(s)"
                return 0
                ;;
            q|Q|n|N|no|quit|cancel)
                # Cancel
                SELECTED_ITEMS=()
                SELECTED_INDICES=()
                echo "  -> Cancelled"
                return 1
                ;;
            a|A|all|y|Y|yes)
                # Select all
                for i in "${!options[@]}"; do
                    selected[$i]=true
                done
                ;;
            x|X|0|none|clear)
                # Deselect all
                for i in "${!options[@]}"; do
                    selected[$i]=false
                done
                ;;
            *)
                # Toggle specific item
                if [[ "$input" =~ ^[0-9]+$ ]] && [[ "$input" -ge 1 ]] && [[ "$input" -le "$num_options" ]]; then
                    local idx=$((input - 1))
                    if [[ "${selected[$idx]}" == true ]]; then
                        selected[$idx]=false
                    else
                        selected[$idx]=true
                    fi
                fi
                ;;
        esac
    done
}

# Text input with optional default
# Usage: prompt_text "prompt" [default]
# Returns: input in $REPLY
prompt_text() {
    local prompt="$1"
    local default="${2:-}"

    # Non-interactive mode: return default
    if [[ "$INTERACTIVE" != true ]]; then
        REPLY="$default"
        echo "$default"
        return 0
    fi

    local hint=""
    if [[ -n "$default" ]]; then
        hint=" [${default}]"
    fi

    echo -n "? ${prompt}${hint}: "
    read -r REPLY

    if [[ -z "$REPLY" ]]; then
        REPLY="$default"
    fi

    echo "$REPLY"
}

# Press any key to continue
press_any_key() {
    local prompt="${1:-Press any key to continue...}"

    if [[ "$INTERACTIVE" != true ]]; then
        return 0
    fi

    echo -n "${prompt}"
    read -rsn1
    echo ""
}

# Simple status message (replaces spinner)
# Usage: status_start "message"
status_start() {
    local message="${1:-Working...}"
    echo -n "  ${message} "
}

# Status done
# Usage: status_done [success]
status_done() {
    local success="${1:-true}"
    if [[ "$success" == true ]]; then
        echo "done"
    else
        echo "failed"
    fi
}

# Progress bar (simple ASCII)
# Usage: progress_bar current total [width]
progress_bar() {
    local current="$1"
    local total="$2"
    local width="${3:-30}"

    if [[ ! -t 1 ]]; then
        return 0
    fi

    local percent=$((current * 100 / total))
    local filled=$((current * width / total))
    local empty=$((width - filled))

    # Build bar string
    local bar=""
    local j
    for ((j = 0; j < filled; j++)); do
        bar="${bar}#"
    done
    for ((j = 0; j < empty; j++)); do
        bar="${bar}-"
    done

    printf "\r  [%s] %3d%% (%d/%d)" "$bar" "$percent" "$current" "$total"

    if [[ "$current" -eq "$total" ]]; then
        echo ""
    fi
}
