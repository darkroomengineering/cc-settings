#!/bin/bash
# lib/packages.sh - Package installation functions
# Part of Darkroom Claude Code Setup

# Detected package managers (set by detect_package_managers)
PM_SYSTEM=""          # brew, apt, dnf, pacman, choco, scoop
PM_SYSTEM_LIST=()     # All available system package managers
PM_NODE=""            # bun, npm, yarn, pnpm
PM_PYTHON=""          # pipx, pip3, pip

# Skip dependency installation
SKIP_DEPS=false

# Detect available package managers
detect_package_managers() {
    PM_SYSTEM_LIST=()

    # System package managers
    case "$OS" in
        macos)
            if has_command brew; then
                PM_SYSTEM="brew"
                PM_SYSTEM_LIST+=("brew")
            fi
            # MacPorts as fallback
            if has_command port; then
                PM_SYSTEM_LIST+=("port")
                [[ -z "$PM_SYSTEM" ]] && PM_SYSTEM="port"
            fi
            ;;
        linux|wsl)
            if has_command apt-get; then
                PM_SYSTEM="apt"
                PM_SYSTEM_LIST+=("apt")
            fi
            if has_command dnf; then
                PM_SYSTEM_LIST+=("dnf")
                [[ -z "$PM_SYSTEM" ]] && PM_SYSTEM="dnf"
            fi
            if has_command yum; then
                PM_SYSTEM_LIST+=("yum")
                [[ -z "$PM_SYSTEM" ]] && PM_SYSTEM="yum"
            fi
            if has_command pacman; then
                PM_SYSTEM_LIST+=("pacman")
                [[ -z "$PM_SYSTEM" ]] && PM_SYSTEM="pacman"
            fi
            if has_command zypper; then
                PM_SYSTEM_LIST+=("zypper")
                [[ -z "$PM_SYSTEM" ]] && PM_SYSTEM="zypper"
            fi
            if has_command apk; then
                PM_SYSTEM_LIST+=("apk")
                [[ -z "$PM_SYSTEM" ]] && PM_SYSTEM="apk"
            fi
            # Homebrew on Linux
            if has_command brew; then
                PM_SYSTEM_LIST+=("brew")
            fi
            ;;
        windows)
            if has_command choco; then
                PM_SYSTEM="choco"
                PM_SYSTEM_LIST+=("choco")
            fi
            if has_command scoop; then
                PM_SYSTEM_LIST+=("scoop")
                [[ -z "$PM_SYSTEM" ]] && PM_SYSTEM="scoop"
            fi
            if has_command winget; then
                PM_SYSTEM_LIST+=("winget")
                [[ -z "$PM_SYSTEM" ]] && PM_SYSTEM="winget"
            fi
            ;;
    esac

    # Node.js package managers (prefer bun)
    if has_command bun; then
        PM_NODE="bun"
    elif has_command pnpm; then
        PM_NODE="pnpm"
    elif has_command yarn; then
        PM_NODE="yarn"
    elif has_command npm; then
        PM_NODE="npm"
    fi

    # Python package managers (prefer pipx for CLI tools)
    if has_command pipx; then
        PM_PYTHON="pipx"
    elif has_command pip3; then
        PM_PYTHON="pip3"
    elif has_command pip; then
        PM_PYTHON="pip"
    fi

    debug "Package managers: SYSTEM=$PM_SYSTEM, NODE=$PM_NODE, PYTHON=$PM_PYTHON"
}

# Install a system package (idempotent)
# Usage: ensure_system_package "package" [command_to_check]
ensure_system_package() {
    local pkg="$1"
    local cmd="${2:-$pkg}"

    # Already installed?
    if has_command "$cmd"; then
        progress_ok "$cmd"
        return 0
    fi

    # Skip if requested
    if [[ "$SKIP_DEPS" == true ]]; then
        progress_skip "$pkg (--skip-deps)"
        return 1
    fi

    # No package manager available?
    if [[ -z "$PM_SYSTEM" ]]; then
        progress_warn "$pkg - no package manager available"
        return 1
    fi

    progress_arrow "Installing $pkg via $PM_SYSTEM..."

    local result=1
    case "$PM_SYSTEM" in
        brew)
            brew install "$pkg" 2>/dev/null && result=0
            ;;
        port)
            sudo port install "$pkg" 2>/dev/null && result=0
            ;;
        apt)
            # Avoid repeated apt-get update
            if [[ "${APT_UPDATED:-}" != true ]]; then
                sudo apt-get update -qq 2>/dev/null
                APT_UPDATED=true
            fi
            sudo apt-get install -y "$pkg" 2>/dev/null && result=0
            ;;
        dnf)
            sudo dnf install -y "$pkg" 2>/dev/null && result=0
            ;;
        yum)
            sudo yum install -y "$pkg" 2>/dev/null && result=0
            ;;
        pacman)
            sudo pacman -S --noconfirm "$pkg" 2>/dev/null && result=0
            ;;
        zypper)
            sudo zypper install -y "$pkg" 2>/dev/null && result=0
            ;;
        apk)
            sudo apk add "$pkg" 2>/dev/null && result=0
            ;;
        choco)
            choco install "$pkg" -y 2>/dev/null && result=0
            ;;
        scoop)
            scoop install "$pkg" 2>/dev/null && result=0
            ;;
        winget)
            winget install --id "$pkg" -e --silent 2>/dev/null && result=0
            ;;
    esac

    if [[ $result -eq 0 ]]; then
        progress_ok "$pkg installed"
        return 0
    else
        progress_fail "Failed to install $pkg"
        return 1
    fi
}

# Install npm global package (idempotent)
# Usage: ensure_npm_global "package" [command_to_check]
ensure_npm_global() {
    local pkg="$1"
    local cmd="${2:-$pkg}"

    # Already installed?
    if has_command "$cmd"; then
        progress_ok "$cmd"
        return 0
    fi

    # Skip if requested
    if [[ "$SKIP_DEPS" == true ]]; then
        progress_skip "$pkg (--skip-deps)"
        return 1
    fi

    # No Node.js package manager?
    if [[ -z "$PM_NODE" ]]; then
        progress_warn "$pkg - npm/bun not available"
        return 1
    fi

    progress_arrow "Installing $pkg via $PM_NODE..."

    local result=1
    case "$PM_NODE" in
        bun)
            bun add --global "$pkg" 2>/dev/null && result=0
            ;;
        pnpm)
            pnpm add -g "$pkg" 2>/dev/null && result=0
            ;;
        yarn)
            yarn global add "$pkg" 2>/dev/null && result=0
            ;;
        npm)
            npm install -g "$pkg" 2>/dev/null && result=0
            ;;
    esac

    if [[ $result -eq 0 ]]; then
        progress_ok "$pkg installed"
        return 0
    else
        progress_fail "Failed to install $pkg"
        return 1
    fi
}

# Install Python package (idempotent)
# Usage: ensure_python_package "package" [command_to_check]
ensure_python_package() {
    local pkg="$1"
    local cmd="${2:-$pkg}"

    # Already installed?
    if has_command "$cmd"; then
        progress_ok "$cmd"
        return 0
    fi

    # Skip if requested
    if [[ "$SKIP_DEPS" == true ]]; then
        progress_skip "$pkg (--skip-deps)"
        return 1
    fi

    # No Python package manager?
    if [[ -z "$PM_PYTHON" ]]; then
        progress_warn "$pkg - pip/pipx not available"
        return 1
    fi

    progress_arrow "Installing $pkg via $PM_PYTHON..."

    local result=1
    case "$PM_PYTHON" in
        pipx)
            pipx install "$pkg" 2>/dev/null && result=0
            # Ensure PATH includes pipx bin directory
            if [[ $result -eq 0 ]]; then
                export PATH="$HOME/.local/bin:$PATH"
            fi
            ;;
        pip3)
            pip3 install --user "$pkg" 2>/dev/null && result=0
            ;;
        pip)
            pip install --user "$pkg" 2>/dev/null && result=0
            ;;
    esac

    if [[ $result -eq 0 ]]; then
        progress_ok "$pkg installed"
        return 0
    else
        progress_fail "Failed to install $pkg"
        return 1
    fi
}

# Ensure pipx is installed (needed for Python CLI tools)
ensure_pipx() {
    if has_command pipx; then
        progress_ok "pipx"
        PM_PYTHON="pipx"
        return 0
    fi

    if [[ "$SKIP_DEPS" == true ]]; then
        progress_skip "pipx (--skip-deps)"
        return 1
    fi

    progress_arrow "Installing pipx..."

    local result=1
    case "$OS" in
        macos)
            if has_command brew; then
                brew install pipx 2>/dev/null && pipx ensurepath 2>/dev/null && result=0
            fi
            ;;
        linux|wsl)
            if has_command apt-get; then
                if [[ "${APT_UPDATED:-}" != true ]]; then
                    sudo apt-get update -qq 2>/dev/null
                    APT_UPDATED=true
                fi
                sudo apt-get install -y pipx 2>/dev/null && pipx ensurepath 2>/dev/null && result=0
            elif has_command pip3; then
                pip3 install --user pipx 2>/dev/null && pipx ensurepath 2>/dev/null && result=0
            fi
            ;;
        windows)
            if has_command pip3; then
                pip3 install pipx 2>/dev/null && pipx ensurepath 2>/dev/null && result=0
            fi
            ;;
    esac

    if [[ $result -eq 0 ]]; then
        progress_ok "pipx installed"
        PM_PYTHON="pipx"
        export PATH="$HOME/.local/bin:$PATH"
        return 0
    else
        progress_warn "Could not install pipx automatically"
        echo "    Install manually:"
        case "$OS" in
            macos)   echo "      brew install pipx && pipx ensurepath" ;;
            linux*)  echo "      sudo apt install pipx && pipx ensurepath" ;;
            windows) echo "      pip install pipx && pipx ensurepath" ;;
        esac
        return 1
    fi
}

# Check if all required dependencies are present
check_required_deps() {
    local missing=()

    # git is always required
    if ! has_command git; then
        missing+=("git")
    fi

    # jq is required for JSON manipulation
    if ! has_command jq; then
        missing+=("jq")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        error "Missing required dependencies: ${missing[*]}"
        echo ""
        echo "Please install the missing dependencies:"
        for dep in "${missing[@]}"; do
            case "$OS" in
                macos)   echo "  brew install $dep" ;;
                linux*)  echo "  sudo apt install $dep" ;;
                windows) echo "  choco install $dep" ;;
            esac
        done
        return 1
    fi

    return 0
}

# Get installation instructions for a package
get_install_hint() {
    local pkg="$1"

    case "$OS" in
        macos)   echo "brew install $pkg" ;;
        linux*)  echo "sudo apt install $pkg" ;;
        windows) echo "choco install $pkg" ;;
        *)       echo "Install $pkg using your package manager" ;;
    esac
}
