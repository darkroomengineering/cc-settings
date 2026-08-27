#!/usr/bin/env bash
# cc-settings bootstrap — the only bash that remains after Phase 5.
# All install logic lives in src/setup.ts. This file exists to:
#   1. Handle remote runs (`curl | bash`, `bash <(curl ...)`, or a lone
#      downloaded setup.sh) by cloning the repo first.
#   2. Ensure Bun is installed.
#   3. exec `bun "$REPO/src/setup.ts" --source="$REPO" "$@"`.
#
# Remote usage — no clone or download needed; flags go after `-s --`:
#   curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh | bash -s -- --light --auto-update=on
#   bash <(curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh) --dry-run
#
# Flags (all forwarded to src/setup.ts):
#   --target=TARGET   auto, claude, codex, or both (default: auto)
#   --source=DIR      source checkout (advanced; normally set by this script)
#   --light           smaller product-specific profile; see docs/install.md
#   --fresh           reinstall as if from scratch; see docs/install.md
#   --rollback[=TS]   restore newest backup (or a timestamp match)
#   --uninstall       remove cc-settings-managed files from selected target
#   --dry-run         print planned actions only
#   --status          print installed vs packaged version info
#   --auto-update=on|off  enable/disable the daily 10am auto-update job
#   --migrate-only    Claude only; both skips Codex; codex target rejects
#   --interactive     prompt on settings.json conflicts (also: CC_INTERACTIVE=1)
#   --help, -h
# Unknown flags and invalid flag values fail closed.

# POSIX guard — everything below uses bash features, and `set -o pipefail`
# alone kills dash. Re-exec a script file under bash; a pipe into a non-bash
# shell cannot be re-exec'd (stdin is already consumed), so name the correct
# invocation instead of failing with a syntax error.
if [ -z "${BASH_VERSION:-}" ]; then
    if [ -f "$0" ]; then
        exec bash "$0" "$@"
    fi
    echo "ERROR: this installer requires bash. Re-run as:" >&2
    echo "  curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh | bash -s -- [flags]" >&2
    exit 1
fi

set -euo pipefail

REPO_URL="https://github.com/darkroomengineering/cc-settings.git"
BUN_MIN="1.2.21"

# --- resolve repo dir ---------------------------------------------------------

# BASH_SOURCE[0] is unset when the script arrives on stdin (`curl | bash`) —
# guard the expansion or `set -u` kills the run before the first message.
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=""
if [[ -n "$SCRIPT_SOURCE" && -f "$SCRIPT_SOURCE" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
fi

# Bootstrap whenever there is no full checkout next to this script: stdin
# pipes (`curl | bash`), process substitution (`bash <(curl ...)` — a pipe
# fd, so the -f test above already left SCRIPT_DIR empty), and a lone
# downloaded setup.sh all land here and clone the official repo first.
if [[ -z "$SCRIPT_DIR" || ! -f "$SCRIPT_DIR/src/setup.ts" || ! -f "$SCRIPT_DIR/package.json" ]]; then
    # A re-exec'd clone that still fails the checkout test above would loop
    # here forever — fail loudly instead.
    if [[ "${CC_SETTINGS_BOOTSTRAPPED:-}" == "1" ]]; then
        echo "ERROR: bootstrap loop — the fetched source is not a usable checkout." >&2
        exit 1
    fi
    DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
    CLONE_DIR="$DATA_HOME/cc-settings/source"
    echo "Fetching cc-settings..."
    if ! command -v git >/dev/null 2>&1; then
        echo "ERROR: git is required for remote install." >&2
        echo "Install git or clone manually: git clone $REPO_URL && bash cc-settings/setup.sh" >&2
        exit 1
    fi

    isolated_git() (
        local git_env_name
        for git_env_name in "${!GIT_@}"; do unset "$git_env_name"; done
        export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_GLOBAL=/dev/null
        export GIT_TERMINAL_PROMPT=0 GIT_NO_REPLACE_OBJECTS=1
        command git \
            -c core.hooksPath=/dev/null \
            -c core.fsmonitor=false \
            -c core.attributesFile=/dev/null \
            -c credential.helper= \
            -c http.proxy= \
            -c http.sslVerify=true \
            "$@"
    )

    isolated_git_with_index() (
        local index_file="$1"
        local git_env_name
        shift
        for git_env_name in "${!GIT_@}"; do unset "$git_env_name"; done
        export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_GLOBAL=/dev/null
        export GIT_TERMINAL_PROMPT=0 GIT_NO_REPLACE_OBJECTS=1 GIT_INDEX_FILE="$index_file"
        command git \
            -c core.hooksPath=/dev/null \
            -c core.fsmonitor=false \
            -c core.attributesFile=/dev/null \
            -c credential.helper= \
            -c http.proxy= \
            -c http.sslVerify=true \
            "$@"
    )

    read_managed_head() {
        local git_dir="$1" head ref ref_file packed hash
        head="$git_dir/HEAD"
        [[ -f "$head" && ! -L "$head" ]] || return 1
        IFS= read -r ref < "$head" || return 1
        if [[ "$ref" == "ref: "* ]]; then
            ref="${ref#ref: }"
            [[ "$ref" =~ ^refs/heads/[A-Za-z0-9._/-]+$ && "$ref" != *..* && "$ref" != *//* ]] || return 1
            ref_file="$git_dir/$ref"
            if [[ -f "$ref_file" && ! -L "$ref_file" ]]; then
                IFS= read -r hash < "$ref_file" || return 1
            else
                packed="$git_dir/packed-refs"
                [[ -f "$packed" && ! -L "$packed" ]] || return 1
                hash="$(awk -v wanted="$ref" '$2 == wanted { print $1; found++ } END { if (found != 1) exit 1 }' "$packed")" || return 1
            fi
        else
            hash="$ref"
        fi
        [[ "$hash" =~ ^[0-9a-fA-F]{40}$ ]] || return 1
        printf '%s\n' "$hash"
    }

    mkdir -p "$(dirname "$CLONE_DIR")"
    STAGING_DIR="$(mktemp -d "$(dirname "$CLONE_DIR")/.source.XXXXXX")"
    CHECK_DIR="$(mktemp -d "$(dirname "$CLONE_DIR")/.source-check.XXXXXX")"
    BACKUP_DIR=""
    trap 'rm -rf "$STAGING_DIR" "$CHECK_DIR"; [[ -z "$BACKUP_DIR" ]] || rm -rf "$BACKUP_DIR"' EXIT

    if [[ -e "$CLONE_DIR" || -L "$CLONE_DIR" ]]; then
        if [[ -L "$CLONE_DIR" || ! -d "$CLONE_DIR/.git" || -L "$CLONE_DIR/.git" ]]; then
            echo "ERROR: managed source collision at $CLONE_DIR." >&2
            echo "Move it aside, then run the installer again." >&2
            exit 1
        fi
        if [[ ! -f "$CLONE_DIR/.git/config" || -L "$CLONE_DIR/.git/config" ]]; then
            echo "ERROR: managed source Git config is missing or unsafe." >&2
            exit 1
        fi
        if ! ORIGIN="$(isolated_git config --file "$CLONE_DIR/.git/config" --no-includes --get-all remote.origin.url)"; then
            echo "ERROR: managed source Git config could not be read safely." >&2
            exit 1
        fi
        if [[ "$ORIGIN" != "$REPO_URL" ]]; then
            echo "ERROR: managed source at $CLONE_DIR has an unexpected origin." >&2
            echo "Expected: $REPO_URL" >&2
            exit 1
        fi
    fi

    if ! isolated_git clone --branch main --single-branch "$REPO_URL" "$STAGING_DIR"; then
        echo "ERROR: git clone failed." >&2
        echo "Clone manually: git clone $REPO_URL && bash cc-settings/setup.sh" >&2
        exit 1
    fi
    if ! OFFICIAL_HEAD="$(isolated_git -C "$STAGING_DIR" rev-parse HEAD)" || [[ ! "$OFFICIAL_HEAD" =~ ^[0-9a-fA-F]{40}$ ]]; then
        echo "ERROR: cloned official main could not be verified." >&2
        exit 1
    fi

    if [[ -e "$CLONE_DIR" || -L "$CLONE_DIR" ]]; then
        if ! LOCAL_HEAD="$(read_managed_head "$CLONE_DIR/.git")"; then
            echo "ERROR: managed source HEAD could not be read safely." >&2
            exit 1
        fi
        if ! isolated_git -C "$STAGING_DIR" merge-base --is-ancestor "$LOCAL_HEAD" "$OFFICIAL_HEAD"; then
            echo "ERROR: managed source contains local commits or diverges from official main." >&2
            echo "Move it aside, then run the installer again." >&2
            exit 1
        fi

        GENERATED_INDEX="$CHECK_DIR/generated-index"
        if ! isolated_git_with_index "$GENERATED_INDEX" --git-dir="$STAGING_DIR/.git" --work-tree="$CLONE_DIR" read-tree "$LOCAL_HEAD"; then
            echo "ERROR: managed source state could not be verified." >&2
            exit 1
        fi
        # read-tree leaves the generated index with zeroed stat data, and
        # diff-files treats stat-less entries as modified without comparing
        # content — refresh first or every clean re-run is refused as
        # "local changes". refresh exits non-zero on real differences;
        # diff-files below is the authoritative check either way.
        isolated_git_with_index "$GENERATED_INDEX" --git-dir="$STAGING_DIR/.git" --work-tree="$CLONE_DIR" update-index --refresh -q >/dev/null 2>&1 || true
        if ! isolated_git_with_index "$GENERATED_INDEX" --git-dir="$STAGING_DIR/.git" --work-tree="$CLONE_DIR" diff-files --quiet --; then
            echo "ERROR: managed source at $CLONE_DIR has local changes." >&2
            echo "Commit, move, or remove that checkout before using the one-line installer." >&2
            exit 1
        fi
        if ! UNTRACKED="$(isolated_git_with_index "$GENERATED_INDEX" --git-dir="$STAGING_DIR/.git" --work-tree="$CLONE_DIR" ls-files --others --exclude-standard)"; then
            echo "ERROR: managed source state could not be verified." >&2
            exit 1
        fi
        if [[ -n "$UNTRACKED" ]]; then
            echo "ERROR: managed source at $CLONE_DIR has local changes." >&2
            echo "Commit, move, or remove that checkout before using the one-line installer." >&2
            exit 1
        fi
        if [[ ! -f "$CLONE_DIR/.git/index" || -L "$CLONE_DIR/.git/index" ]]; then
            echo "ERROR: managed source index is missing or unsafe." >&2
            exit 1
        fi
        cp "$CLONE_DIR/.git/index" "$CHECK_DIR/original-index"
        if ! isolated_git_with_index "$CHECK_DIR/original-index" --git-dir="$STAGING_DIR/.git" --work-tree="$CLONE_DIR" diff-index --cached --quiet "$LOCAL_HEAD" --; then
            echo "ERROR: managed source at $CLONE_DIR has staged changes or an unreadable index." >&2
            exit 1
        fi

        if ! isolated_git -C "$STAGING_DIR" checkout -B main "$LOCAL_HEAD" >/dev/null 2>&1 || \
           ! isolated_git -C "$STAGING_DIR" merge --ff-only "$OFFICIAL_HEAD" >/dev/null 2>&1; then
            echo "ERROR: managed source fast-forward failed." >&2
            exit 1
        fi
        if ! MERGED_HEAD="$(isolated_git -C "$STAGING_DIR" rev-parse HEAD)" || [[ "$MERGED_HEAD" != "$OFFICIAL_HEAD" ]]; then
            echo "ERROR: managed source does not exactly match fetched official main." >&2
            exit 1
        fi

        BACKUP_DIR="$(dirname "$CLONE_DIR")/.source.previous.$$.$RANDOM"
        if ! mv "$CLONE_DIR" "$BACKUP_DIR"; then
            BACKUP_DIR=""
            echo "ERROR: managed source replacement failed; the previous checkout remains in place." >&2
            exit 1
        fi
        if ! mv "$STAGING_DIR" "$CLONE_DIR"; then
            PRESERVED_BACKUP="$BACKUP_DIR"
            BACKUP_DIR=""
            if mv "$PRESERVED_BACKUP" "$CLONE_DIR" 2>/dev/null; then
                echo "ERROR: managed source replacement failed; the previous checkout was restored." >&2
            else
                echo "ERROR: managed source replacement failed; the previous checkout remains at $PRESERVED_BACKUP." >&2
            fi
            exit 1
        fi
        rm -rf "$BACKUP_DIR"
        BACKUP_DIR=""
    elif ! mv "$STAGING_DIR" "$CLONE_DIR"; then
        echo "ERROR: managed source collision at $CLONE_DIR." >&2
        exit 1
    fi
    rm -rf "$CHECK_DIR"
    CHECK_DIR=""
    trap - EXIT
    if [[ ! -f "$CLONE_DIR/src/setup.ts" || ! -f "$CLONE_DIR/package.json" ]]; then
        echo "ERROR: fetched source at $CLONE_DIR is missing expected files." >&2
        exit 1
    fi
    export CC_SETTINGS_BOOTSTRAPPED=1
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

# Install/refresh deps under the source repo. The lockfile is authoritative and
# lifecycle scripts stay disabled because this bootstrap crosses a supply-chain
# boundary before the TypeScript installer can perform its own checks.
if ! (cd "$SCRIPT_DIR" && bun install --frozen-lockfile --ignore-scripts >/dev/null 2>&1); then
    echo "ERROR: dependency install failed with the frozen lockfile." >&2
    echo "Run 'bun install --frozen-lockfile --ignore-scripts' in $SCRIPT_DIR for details." >&2
    exit 1
fi

exec bun "$SCRIPT_DIR/src/setup.ts" --source="$SCRIPT_DIR" "$@"
