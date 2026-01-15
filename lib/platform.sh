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

# Get the home directory (cross-platform)
get_home_dir() {
    if [[ "$OS" == "windows" ]] && [[ -n "${USERPROFILE:-}" ]]; then
        # Convert Windows path to Unix-style for Git Bash/Cygwin
        normalize_path "$USERPROFILE"
    else
        echo "${HOME:-$(eval echo ~)}"
    fi
}

# Normalize path (convert Windows paths to Unix-style)
normalize_path() {
    local path="$1"

    if [[ "$OS" == "windows" ]] || [[ "$IS_WSL" == true ]]; then
        # Convert backslashes to forward slashes
        path="${path//\\//}"

        # Convert C: to /c (Git Bash style) or /mnt/c (WSL style)
        if [[ "$path" =~ ^([A-Za-z]): ]]; then
            local drive="${BASH_REMATCH[1]}"
            drive=$(echo "$drive" | tr '[:upper:]' '[:lower:]')
            if [[ "$IS_WSL" == true ]]; then
                path="/mnt/${drive}${path:2}"
            else
                path="/${drive}${path:2}"
            fi
        fi
    fi

    # Remove trailing slash if present (unless root)
    if [[ ${#path} -gt 1 ]] && [[ "$path" == */ ]]; then
        path="${path%/}"
    fi

    echo "$path"
}

# Convert Unix path back to Windows format (for Windows commands)
to_windows_path() {
    local path="$1"

    if [[ "$OS" != "windows" ]] && [[ "$IS_WSL" != true ]]; then
        echo "$path"
        return
    fi

    # Convert /c/... to C:\... or /mnt/c/... to C:\...
    if [[ "$path" =~ ^/mnt/([a-z])/(.*) ]]; then
        echo "${BASH_REMATCH[1]^^}:\\${BASH_REMATCH[2]//\//\\}"
    elif [[ "$path" =~ ^/([a-z])/(.*) ]]; then
        echo "${BASH_REMATCH[1]^^}:\\${BASH_REMATCH[2]//\//\\}"
    else
        echo "$path"
    fi
}

# Get file size (cross-platform)
get_file_size() {
    local file="$1"

    if [[ ! -f "$file" ]]; then
        echo "0"
        return 1
    fi

    case "$OS" in
        macos)
            stat -f%z "$file" 2>/dev/null || echo "0"
            ;;
        *)
            stat -c%s "$file" 2>/dev/null || echo "0"
            ;;
    esac
}

# Get file modification time (cross-platform, returns Unix timestamp)
get_file_mtime() {
    local file="$1"

    if [[ ! -f "$file" ]]; then
        echo "0"
        return 1
    fi

    case "$OS" in
        macos)
            stat -f%m "$file" 2>/dev/null || echo "0"
            ;;
        *)
            stat -c%Y "$file" 2>/dev/null || echo "0"
            ;;
    esac
}

# Check if running with administrator/sudo privileges
is_admin() {
    case "$OS" in
        windows)
            # Check for Windows admin (limited detection in Git Bash)
            net session &>/dev/null
            return $?
            ;;
        *)
            [[ "$(id -u)" -eq 0 ]]
            return $?
            ;;
    esac
}

# Check if a path is writable
is_writable() {
    local path="$1"

    if [[ -e "$path" ]]; then
        [[ -w "$path" ]]
    else
        # Check if parent directory is writable
        local parent
        parent="$(dirname "$path")"
        [[ -w "$parent" ]]
    fi
}

# Create a temporary directory (cross-platform)
create_temp_dir() {
    local prefix="${1:-darkroom-setup}"

    if command -v mktemp &>/dev/null; then
        mktemp -d -t "${prefix}.XXXXXX"
    else
        local tmp_dir
        tmp_dir="${TMPDIR:-${TMP:-/tmp}}/${prefix}.$$"
        mkdir -p "$tmp_dir"
        echo "$tmp_dir"
    fi
}

# Get current timestamp for backups
get_timestamp() {
    date +%Y%m%d%H%M%S
}

# Platform-specific command check
has_command() {
    command -v "$1" &>/dev/null
}

# Run a command with timeout (cross-platform)
run_with_timeout() {
    local timeout_sec="$1"
    shift

    if has_command timeout; then
        timeout "$timeout_sec" "$@"
    elif has_command gtimeout; then
        gtimeout "$timeout_sec" "$@"
    else
        # Fallback: run without timeout
        "$@"
    fi
}
