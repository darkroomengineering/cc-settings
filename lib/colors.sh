#!/bin/bash
# lib/colors.sh - Terminal colors and styled output
# Part of Darkroom Claude Code Setup

# Color codes (will be set by setup_colors)
RED=""
GREEN=""
YELLOW=""
BLUE=""
MAGENTA=""
CYAN=""
BOLD=""
DIM=""
RESET=""

# Detect color support and set up color codes
setup_colors() {
    # Check if stdout is a terminal and supports colors
    if [[ -t 1 ]] && [[ "${NO_COLOR:-}" != "1" ]]; then
        # Check for color support
        if [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
            RED='\033[0;31m'
            GREEN='\033[0;32m'
            YELLOW='\033[0;33m'
            BLUE='\033[0;34m'
            MAGENTA='\033[0;35m'
            CYAN='\033[0;36m'
            BOLD='\033[1m'
            DIM='\033[2m'
            RESET='\033[0m'
        fi
    fi
}

# Styled output functions
info() {
    echo -e "${BLUE}[INFO]${RESET} $*"
}

success() {
    echo -e "${GREEN}[OK]${RESET} $*"
}

warn() {
    echo -e "${YELLOW}[WARN]${RESET} $*"
}

error() {
    echo -e "${RED}[ERROR]${RESET} $*" >&2
}

debug() {
    if [[ "${DEBUG:-}" == "1" ]]; then
        echo -e "${DIM}[DEBUG]${RESET} $*"
    fi
}

# Styled headers
header() {
    local text="$1"
    local width=44
    local padding=$(( (width - ${#text} - 2) / 2 ))
    local pad_left=$(printf '%*s' "$padding" '')
    local pad_right=$(printf '%*s' "$((width - ${#text} - 2 - padding))" '')

    echo ""
    echo -e "${BOLD}+$(printf '%*s' "$width" '' | tr ' ' '-')+${RESET}"
    echo -e "${BOLD}|${pad_left} ${text} ${pad_right}|${RESET}"
    echo -e "${BOLD}+$(printf '%*s' "$width" '' | tr ' ' '-')+${RESET}"
    echo ""
}

# Progress indicator with checkmark or warning
progress_ok() {
    echo -e "  ${GREEN}[OK]${RESET} $*"
}

progress_warn() {
    echo -e "  ${YELLOW}[!]${RESET} $*"
}

progress_fail() {
    echo -e "  ${RED}[X]${RESET} $*"
}

progress_skip() {
    echo -e "  ${DIM}[-]${RESET} $*"
}

progress_arrow() {
    echo -e "  ${CYAN}->${RESET} $*"
}

# Box drawing for feature lists
box_start() {
    local title="${1:-}"
    echo -e "${BOLD}+-------------------------------------------+${RESET}"
    if [[ -n "$title" ]]; then
        printf "${BOLD}| %-41s |${RESET}\n" "$title"
        echo -e "${BOLD}+-------------------------------------------+${RESET}"
    fi
}

box_line() {
    local status="$1"
    local text="$2"
    local symbol

    case "$status" in
        ok)   symbol="${GREEN}[OK]${RESET}" ;;
        warn) symbol="${YELLOW}[!]${RESET}" ;;
        fail) symbol="${RED}[X]${RESET}" ;;
        *)    symbol="   " ;;
    esac

    # Adjust for ANSI codes in symbol
    printf "| ${symbol} %-36s |\n" "$text"
}

box_end() {
    echo -e "${BOLD}+-------------------------------------------+${RESET}"
}

# Banner for script start
show_banner() {
    local version="${1:-5.1}"
    echo ""
    echo -e "${BOLD}${CYAN}+============================================+${RESET}"
    echo -e "${BOLD}${CYAN}|   Darkroom Claude Code Setup v${version}         |${RESET}"
    echo -e "${BOLD}${CYAN}|   Batteries Included - Auto-Install       |${RESET}"
    echo -e "${BOLD}${CYAN}|   (Idempotent - safe to re-run)           |${RESET}"
    echo -e "${BOLD}${CYAN}+============================================+${RESET}"
    echo ""
}

# Final success banner
show_success_banner() {
    echo ""
    echo -e "${BOLD}${GREEN}+============================================+${RESET}"
    echo -e "${BOLD}${GREEN}|           Setup Complete!                 |${RESET}"
    echo -e "${BOLD}${GREEN}+============================================+${RESET}"
    echo ""
}

# Initialize colors on source
setup_colors
