#!/usr/bin/env bash
# Audio Notification Script
# Plays system sounds for Claude Code hook events
# Designed to be non-blocking (plays in background) and fail-open (exit 0 always)
#
# Usage: bash notify-sound.sh <event_name>
# Events: session_start, commit, error, task_complete, safety_block

# ---------------------------------------------------------------------------
# Fail-open wrapper: all errors -> exit 0
# ---------------------------------------------------------------------------
set +e

CLAUDE_DIR="${HOME}/.claude"

# Source hook config for audio settings
if [[ -f "${CLAUDE_DIR}/lib/hook-config.sh" ]]; then
    source "${CLAUDE_DIR}/lib/hook-config.sh"
else
    exit 0
fi

# ---------------------------------------------------------------------------
# Check if audio is enabled globally and for this specific event
# ---------------------------------------------------------------------------
EVENT="${1:-}"
[[ -z "$EVENT" ]] && exit 0

# Check global audio toggle
if ! is_hook_enabled "audio.enabled" "false"; then
    exit 0
fi

# Check per-event toggle
if ! is_hook_enabled "audio.events.${EVENT}" "true"; then
    exit 0
fi

# Get volume setting (0.0 - 1.0)
VOLUME=$(get_hook_config "audio.volume" "0.5")

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------
detect_os() {
    local uname_s
    uname_s="$(uname -s)"
    case "$uname_s" in
        Darwin*) echo "macos" ;;
        Linux*)  echo "linux" ;;
        *)       echo "unknown" ;;
    esac
}

PLATFORM=$(detect_os)

# ---------------------------------------------------------------------------
# Sound file mapping
# ---------------------------------------------------------------------------

# Map event names to macOS system sounds
get_macos_sound() {
    local event="$1"
    local sounds_dir="/System/Library/Sounds"

    case "$event" in
        session_start)  echo "${sounds_dir}/Hero.aiff" ;;
        commit)         echo "${sounds_dir}/Glass.aiff" ;;
        error)          echo "${sounds_dir}/Basso.aiff" ;;
        task_complete)  echo "${sounds_dir}/Purr.aiff" ;;
        safety_block)   echo "${sounds_dir}/Basso.aiff" ;;
        *)              echo "${sounds_dir}/Ping.aiff" ;;
    esac
}

# Map event names to Linux freedesktop sounds
get_linux_sound() {
    local event="$1"
    local sounds_base="/usr/share/sounds/freedesktop/stereo"

    case "$event" in
        session_start)  echo "${sounds_base}/service-login.oga" ;;
        commit)         echo "${sounds_base}/complete.oga" ;;
        error)          echo "${sounds_base}/dialog-error.oga" ;;
        task_complete)  echo "${sounds_base}/complete.oga" ;;
        safety_block)   echo "${sounds_base}/dialog-warning.oga" ;;
        *)              echo "${sounds_base}/message.oga" ;;
    esac
}

# ---------------------------------------------------------------------------
# Playback
# ---------------------------------------------------------------------------

play_sound() {
    local sound_file="$1"

    # Verify the sound file exists
    [[ ! -f "$sound_file" ]] && return 0

    case "$PLATFORM" in
        macos)
            if command -v afplay &>/dev/null; then
                # afplay volume is a float where 1.0 = normal playback volume
                afplay -v "$VOLUME" "$sound_file" &>/dev/null &
                disown 2>/dev/null
            fi
            ;;
        linux)
            if command -v paplay &>/dev/null; then
                # paplay volume: 0-65536, config volume: 0.0-1.0
                local pa_volume
                pa_volume=$(awk "BEGIN {printf \"%.0f\", ${VOLUME} * 65536}" 2>/dev/null || echo 32768)
                paplay --volume="$pa_volume" "$sound_file" &>/dev/null &
                disown 2>/dev/null
            elif command -v aplay &>/dev/null; then
                # aplay does not support volume natively, play at system volume
                aplay "$sound_file" &>/dev/null &
                disown 2>/dev/null
            fi
            ;;
    esac

    return 0
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

case "$PLATFORM" in
    macos)
        sound_file=$(get_macos_sound "$EVENT")
        ;;
    linux)
        sound_file=$(get_linux_sound "$EVENT")
        ;;
    *)
        # Unsupported platform -- exit silently
        exit 0
        ;;
esac

play_sound "$sound_file"

exit 0
