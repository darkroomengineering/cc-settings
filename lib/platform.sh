#!/usr/bin/env bash
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

# Get file modification time (Unix epoch) - cross-platform
# Usage: get_file_mtime <file>
get_file_mtime() {
    stat -f%m "$1" 2>/dev/null || stat -c%Y "$1" 2>/dev/null || echo 0
}

# Get file size in bytes - cross-platform
# Usage: get_file_size <file>
get_file_size() {
    stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo 0
}

# Get file modification time in human-readable format - cross-platform
# Usage: get_file_mtime_human <file>
get_file_mtime_human() {
    stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$1" 2>/dev/null || stat -c "%y" "$1" 2>/dev/null | cut -d. -f1
}

# Platform-specific command check
has_command() {
    command -v "$1" &>/dev/null
}
