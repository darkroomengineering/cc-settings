#!/usr/bin/env bash
# lib/hook-config.sh - Two-tier hook configuration reader
# Part of Darkroom Claude Code Setup
#
# Reads config values with a two-tier fallback:
#   1. ~/.claude/hooks-config.local.json (personal overrides, git-ignored)
#   2. ~/.claude/hooks-config.json (team defaults)
#
# Usage:
#   source "$HOME/.claude/lib/hook-config.sh"
#   value=$(get_hook_config "audio.enabled")
#   volume=$(get_hook_config "audio.volume")

HOOK_CONFIG_DIR="${HOME}/.claude"
HOOK_CONFIG_LOCAL="${HOOK_CONFIG_DIR}/hooks-config.local.json"
HOOK_CONFIG_TEAM="${HOOK_CONFIG_DIR}/hooks-config.json"

# get_hook_config - Read a config value using dot-notation key path
#
# Args:
#   $1 - key path in dot-notation (e.g., "audio.enabled", "audio.events.commit")
#   $2 - default value if key is not found (optional, defaults to empty string)
#
# Returns:
#   The config value via stdout. Returns the default if key not found in either file.
#   Exit code is always 0 (fail-open).
#
# Examples:
#   enabled=$(get_hook_config "audio.enabled" "false")
#   volume=$(get_hook_config "audio.volume" "0.5")
#   threshold=$(get_hook_config "compact_reminder.threshold_percent" "60")
get_hook_config() {
    local key_path="$1"
    local default_value="${2:-}"

    # Require jq
    if ! command -v jq &>/dev/null; then
        echo "$default_value"
        return 0
    fi

    # Convert dot-notation to jq path (e.g., "audio.enabled" -> ".audio.enabled")
    local jq_path=".${key_path}"

    # Try local config first (personal overrides)
    if [[ -f "$HOOK_CONFIG_LOCAL" ]]; then
        local local_type
        local_type=$(jq -r "$jq_path | type" "$HOOK_CONFIG_LOCAL" 2>/dev/null)
        if [[ "$local_type" != "null" ]] && [[ -n "$local_type" ]]; then
            jq -r "if ($jq_path | type) == \"null\" then empty else ($jq_path | tostring) end" "$HOOK_CONFIG_LOCAL" 2>/dev/null
            return 0
        fi
    fi

    # Fall back to team config
    if [[ -f "$HOOK_CONFIG_TEAM" ]]; then
        local team_type
        team_type=$(jq -r "$jq_path | type" "$HOOK_CONFIG_TEAM" 2>/dev/null)
        if [[ "$team_type" != "null" ]] && [[ -n "$team_type" ]]; then
            jq -r "if ($jq_path | type) == \"null\" then empty else ($jq_path | tostring) end" "$HOOK_CONFIG_TEAM" 2>/dev/null
            return 0
        fi
    fi

    # Neither file has the key -- return default
    echo "$default_value"
    return 0
}

# is_hook_enabled - Convenience function to check boolean config values
#
# Args:
#   $1 - key path in dot-notation
#   $2 - default value (optional, defaults to "false")
#
# Returns:
#   Exit code 0 if enabled (value is "true"), 1 otherwise.
#
# Example:
#   if is_hook_enabled "audio.enabled"; then
#       echo "Audio is on"
#   fi
is_hook_enabled() {
    local key_path="$1"
    local default_value="${2:-false}"
    local value
    value=$(get_hook_config "$key_path" "$default_value")
    [[ "$value" == "true" ]]
}
