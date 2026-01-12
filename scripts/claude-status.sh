#!/bin/bash
# Claude Code Status Line Script
# Outputs status info for the Claude Code status line

# Colors (ANSI)
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RESET='\033[0m'

# Get git branch
GIT_BRANCH=""
if git rev-parse --git-dir > /dev/null 2>&1; then
    GIT_BRANCH=$(git branch --show-current 2>/dev/null)
fi

# Get working directory (shortened)
CWD=$(basename "$PWD")

# Build status line
STATUS=""

# Git branch
if [ -n "$GIT_BRANCH" ]; then
    STATUS="${STATUS}${GREEN}⎇ ${GIT_BRANCH}${RESET}"
fi

# Working directory
if [ -n "$STATUS" ]; then
    STATUS="${STATUS} ${CYAN}│${RESET} "
fi
STATUS="${STATUS}${CYAN}📁 ${CWD}${RESET}"

# Output
echo -e "$STATUS"
