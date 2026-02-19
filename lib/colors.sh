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
# Using Darkroom Engineering brand colors from Satus
setup_colors() {
    # Check if stdout is a terminal and supports colors
    if [[ -t 1 ]] && [[ "${NO_COLOR:-}" != "1" ]]; then
        local colors
        colors=$(tput colors 2>/dev/null || echo 0)

        # Prefer 24-bit true color for exact brand colors
        if [[ "${COLORTERM:-}" == "truecolor" ]] || [[ "${COLORTERM:-}" == "24bit" ]] || [[ "$colors" -ge 256 ]]; then
            # Darkroom brand palette (from lib/styles/colors.ts)
            RED='\033[38;2;227;6;19m'       # #e30613
            GREEN='\033[38;2;0;255;136m'    # #00ff88
            YELLOW='\033[38;2;255;180;0m'   # warm amber (complement)
            BLUE='\033[38;2;0;112;243m'     # #0070f3
            MAGENTA='\033[38;2;255;0;128m'  # #ff0080
            CYAN='\033[38;2;121;40;202m'    # #7928ca (purple)
            BOLD='\033[1m'
            DIM='\033[2m'
            RESET='\033[0m'
        elif [[ "$colors" -ge 8 ]]; then
            # Fallback to standard ANSI colors
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
    echo -e "${BLUE}ℹ${RESET} $*"
}

success() {
    echo -e "${GREEN}✓${RESET} $*"
}

warn() {
    echo -e "${YELLOW}⚠${RESET} $*"
}

error() {
    echo -e "${RED}✗${RESET} $*" >&2
}

debug() {
    if [[ "${DEBUG:-}" == "1" ]]; then
        echo -e "${DIM}○${RESET} $*"
    fi
}

# Progress indicator with checkmark or warning
progress_ok() {
    echo -e "  ${GREEN}✓${RESET} $*"
}

progress_warn() {
    echo -e "  ${YELLOW}⚠${RESET} $*"
}

progress_fail() {
    echo -e "  ${RED}✗${RESET} $*"
}

progress_skip() {
    echo -e "  ${DIM}○${RESET} $*"
}

progress_arrow() {
    echo -e "  ${CYAN}→${RESET} $*"
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
        ok)   symbol="${GREEN}✓${RESET}" ;;
        warn) symbol="${YELLOW}⚠${RESET}" ;;
        fail) symbol="${RED}✗${RESET}" ;;
        *)    symbol=" " ;;
    esac

    # Adjust for ANSI codes in symbol
    printf "| ${symbol} %-38s |\n" "$text"
}

box_end() {
    echo -e "${BOLD}+-------------------------------------------+${RESET}"
}

# Banner for script start
show_banner() {
    local version="${1:-7.0}"
    echo ""
    echo -e "${BOLD}${CYAN}+============================================+${RESET}"
    echo -e "${BOLD}${CYAN}|   Darkroom Claude Code Setup v${version}         |${RESET}"
    echo -e "${BOLD}${CYAN}|   Batteries Included - Auto-Install       |${RESET}"
    echo -e "${BOLD}${CYAN}|   (Idempotent - safe to re-run)           |${RESET}"
    echo -e "${BOLD}${CYAN}+============================================+${RESET}"
    echo ""
}

# Initialize colors on source
setup_colors
