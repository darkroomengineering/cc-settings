#!/bin/bash
# lib/prompts.sh - Interactive CLI prompts
# Part of Darkroom Claude Code Setup

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

# Yes/No prompt with default
# Usage: prompt_yn "Question?" [y|n]
# Returns: 0 for yes, 1 for no
prompt_yn() {
    local prompt="$1"
    local default="${2:-y}"

    # Non-interactive mode: return default
    if [[ "$INTERACTIVE" != true ]]; then
        [[ "${default,,}" == "y" ]]
        return $?
    fi

    local hint
    if [[ "${default,,}" == "y" ]]; then
        hint="(y/n, default: yes)"
    else
        hint="(y/n, default: no)"
    fi

    while true; do
        echo -en "${CYAN}?${RESET} ${prompt} ${hint} "
        read -r response

        # Empty response: use default
        if [[ -z "$response" ]]; then
            response="$default"
        fi

        case "${response,,}" in
            y|yes)
                return 0
                ;;
            n|no)
                return 1
                ;;
            *)
                echo "  Please enter 'y' for yes or 'n' for no."
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

    echo -e "${CYAN}?${RESET} ${prompt}"
    echo ""

    local i
    for i in "${!options[@]}"; do
        printf "  %d. %s\n" "$((i + 1))" "${options[$i]}"
    done

    echo ""

    while true; do
        echo -en "  Enter number (1-${num_options}): "
        read -r choice

        if [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 ]] && [[ "$choice" -le "$num_options" ]]; then
            REPLY=$((choice - 1))
            echo ""
            echo "${options[$REPLY]}"
            return 0
        else
            echo "  Enter a number between 1 and ${num_options}"
        fi
    done
}

# Multiple selection menu (checkbox style)
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

    echo -e "${CYAN}?${RESET} ${prompt}"
    echo ""

    while true; do
        # Display options with checkboxes
        for i in "${!options[@]}"; do
            local checkbox
            if [[ "${selected[$i]}" == true ]]; then
                checkbox="${GREEN}✓${RESET}"
            else
                checkbox="${DIM}-${RESET}"
            fi
            printf "  %s %d. %s\n" "$checkbox" "$((i + 1))" "${options[$i]}"
        done

        echo ""
        echo -e "  ${DIM}Enter number to toggle, or:${RESET}"
        echo -en "  ${DIM}a=all, x=none, q=cancel, Enter=done${RESET} > "
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
                echo ""
                return 0
                ;;
            q|Q|n|N|no|quit|cancel)
                # Cancel
                SELECTED_ITEMS=()
                SELECTED_INDICES=()
                echo ""
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

        # Clear previous output for redraw (move cursor up)
        local lines_to_clear=$((num_options + 3))
        printf '\033[%dA\033[J' "$lines_to_clear"
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
        hint=" (default: ${default})"
    fi

    echo -en "${CYAN}?${RESET} ${prompt}${hint}: "
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

    echo -en "${DIM}${prompt}${RESET}"
    read -rsn1
    echo ""
}

# Spinner for long operations (run in background)
# Usage: start_spinner "message" && long_operation && stop_spinner
SPINNER_PID=""

start_spinner() {
    local message="${1:-Working...}"

    if [[ "$INTERACTIVE" != true ]] || [[ ! -t 1 ]]; then
        echo "$message"
        return 0
    fi

    (
        local spin_chars='|/-\'
        local i=0
        while true; do
            printf "\r${CYAN}%s${RESET} %s " "${spin_chars:$((i % 4)):1}" "$message"
            i=$((i + 1))
            sleep 0.1
        done
    ) &
    SPINNER_PID=$!
}

stop_spinner() {
    local success="${1:-true}"

    if [[ -n "$SPINNER_PID" ]]; then
        kill "$SPINNER_PID" 2>/dev/null
        wait "$SPINNER_PID" 2>/dev/null
        SPINNER_PID=""
        printf "\r\033[K"  # Clear line
    fi

    if [[ "$success" == true ]]; then
        echo -e "${GREEN}Done${RESET}"
    fi
}

# Progress bar
# Usage: progress_bar current total [width]
progress_bar() {
    local current="$1"
    local total="$2"
    local width="${3:-40}"

    if [[ ! -t 1 ]]; then
        return 0
    fi

    local percent=$((current * 100 / total))
    local filled=$((current * width / total))
    local empty=$((width - filled))

    printf "\r  ["
    printf "${GREEN}%*s${RESET}" "$filled" '' | tr ' ' '#'
    printf "%*s" "$empty" ''
    printf "] %3d%% (%d/%d)" "$percent" "$current" "$total"

    if [[ "$current" -eq "$total" ]]; then
        echo ""
    fi
}
