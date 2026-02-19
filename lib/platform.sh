#!/bin/bash
# lib/platform.sh - OS detection and path normalization
# Part of Darkroom Claude Code Setup

# Global platform variables (set by detect_platform)
OS=""

# Detect the current platform
detect_platform() {
    local uname_s
    uname_s="$(uname -s)"

    case "$uname_s" in
        Darwin*)
            OS="macos"
            ;;
        Linux*)
            OS="linux"
            # Check for WSL
            if grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null || [[ -n "${WSL_DISTRO_NAME:-}" ]]; then
                OS="wsl"
            fi
            ;;
        MINGW*|MSYS*)
            OS="windows"
            ;;
        CYGWIN*)
            OS="windows"
            ;;
        *)
            OS="unknown"
            ;;
    esac

    debug "Platform detected: OS=$OS"
}

# Get current timestamp for backups
get_timestamp() {
    date +%Y%m%d%H%M%S
}

# Platform-specific command check
has_command() {
    command -v "$1" &>/dev/null
}
