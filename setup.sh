#!/usr/bin/env bash
# cc-settings bootstrap — the only bash that remains after Phase 5.
# All install logic lives in src/setup.ts. This file exists to:
#   1. Handle `bash <(curl ...)` by cloning the repo.
#   2. Ensure Bun is installed.
#   3. exec `bun "$REPO/src/setup.ts" --source="$REPO" "$@"`.
#
# Flags (all forwarded to src/setup.ts):
#   --rollback[=TS]   restore newest backup (or a timestamp match)
#   --dry-run         print planned actions only
#   --interactive     prompt on settings.json conflicts (also: CC_INTERACTIVE=1)
#   --ts-hooks        install with TS hook paths (also: CC_USE_TS_HOOKS=1)
#   --help, -h

set -euo pipefail

REPO_URL="https://github.com/darkroomengineering/cc-settings.git"
BUN_MIN="1.1.30"

# --- resolve repo dir (handle `bash <(curl ...)` via process substitution) ---

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$SCRIPT_DIR" == "/dev/fd" || "$SCRIPT_DIR" == /proc/self/fd* ]]; then
    CLONE_DIR="$(mktemp -d)"
    trap 'rm -rf "$CLONE_DIR"' EXIT
    echo "Fetching cc-settings..."
    if ! command -v git >/dev/null 2>&1; then
        echo "ERROR: git is required for remote install." >&2
        echo "Install git or clone manually: git clone $REPO_URL && bash cc-settings/setup.sh" >&2
        exit 1
    fi
    git clone --depth 1 "$REPO_URL" "$CLONE_DIR" 2>/dev/null
    exec bash "$CLONE_DIR/setup.sh" "$@"
fi

# --- ensure Bun --------------------------------------------------------------

ensure_bun() {
    if command -v bun >/dev/null 2>&1; then
        return 0
    fi
    echo "Bun not found — installing via https://bun.sh/install..."
    if ! command -v curl >/dev/null 2>&1; then
        echo "ERROR: curl is required to install Bun." >&2
        echo "Install Bun manually: https://bun.sh/docs/installation" >&2
        exit 1
    fi
    curl -fsSL https://bun.sh/install | bash
    # The installer writes to ~/.bun/bin. Add it for this session.
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    export PATH="$BUN_INSTALL/bin:$PATH"
    if ! command -v bun >/dev/null 2>&1; then
        echo "ERROR: bun install completed but 'bun' is not on PATH." >&2
        echo "Re-run this script from a new shell, or add \$HOME/.bun/bin to PATH." >&2
        exit 1
    fi
}

ensure_bun

# --- delegate to src/setup.ts ------------------------------------------------

# Install/refresh deps under the source repo (bun install is idempotent and
# fast when the lockfile is already satisfied). This ensures zod, yaml, and
# @inquirer/prompts are resolvable for the TS installer.
(cd "$SCRIPT_DIR" && bun install --frozen-lockfile >/dev/null 2>&1) || (cd "$SCRIPT_DIR" && bun install >/dev/null 2>&1)

exec bun "$SCRIPT_DIR/src/setup.ts" --source="$SCRIPT_DIR" "$@"
