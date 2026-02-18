#!/bin/bash
# lib/platform.sh - OS detection and path normalization
# Part of Darkroom Claude Code Setup

# Global platform variables (set by detect_platform)
OS=""
OS_VERSION=""
ARCH=""
IS_WSL=false
IS_GITBASH=false
IS_CYGWIN=false

# Detect the current platform
detect_platform() {
    local uname_s
    uname_s="$(uname -s)"

    case "$uname_s" in
        Darwin*)
            OS="macos"
            OS_VERSION="$(sw_vers -productVersion 2>/dev/null || echo 'unknown')"
            ;;
        Linux*)
            OS="linux"
            # Check for WSL
            if grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null || [[ -n "${WSL_DISTRO_NAME:-}" ]]; then
                IS_WSL=true
                OS="wsl"
            fi
            # Try to get distro info
            if [[ -f /etc/os-release ]]; then
                OS_VERSION="$(. /etc/os-release && echo "${PRETTY_NAME:-$NAME}")"
            else
                OS_VERSION="$(uname -r)"
            fi
            ;;
        MINGW*|MSYS*)
            OS="windows"
            IS_GITBASH=true
            OS_VERSION="Git Bash"
            ;;
        CYGWIN*)
            OS="windows"
            IS_CYGWIN=true
            OS_VERSION="Cygwin"
            ;;
        *)
            OS="unknown"
            OS_VERSION="unknown"
            ;;
    esac

    # Detect architecture
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64|amd64) ARCH="x64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        armv7*) ARCH="arm" ;;
    esac

    debug "Platform detected: OS=$OS, VERSION=$OS_VERSION, ARCH=$ARCH, WSL=$IS_WSL, GITBASH=$IS_GITBASH"
}

# Get current timestamp for backups
get_timestamp() {
    date +%Y%m%d%H%M%S
}

# Platform-specific command check
has_command() {
    command -v "$1" &>/dev/null
}
