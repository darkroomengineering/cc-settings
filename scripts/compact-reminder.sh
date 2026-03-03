#!/usr/bin/env bash
# Compact Reminder - Stop hook
# Checks if a heavy skill was recently active and suggests /compact
# Fail-open: exit 0 always

CLAUDE_DIR="${HOME}/.claude"
MARKER_FILE="${CLAUDE_DIR}/tmp/heavy-skill-active"

# Source hook config for enabled toggle
if [[ -f "${CLAUDE_DIR}/lib/hook-config.sh" ]]; then
    source "${CLAUDE_DIR}/lib/hook-config.sh"
else
    exit 0
fi

# Check if compact reminder is enabled
is_hook_enabled "compact_reminder.enabled" "true" || exit 0

# Exit early if no marker file
[[ -f "$MARKER_FILE" ]] || exit 0

# Read marker contents
SKILL_NAME=$(head -1 "$MARKER_FILE" 2>/dev/null)

# Clean up the marker immediately (one-shot reminder)
rm -f "$MARKER_FILE" 2>/dev/null

# Validate we got a skill name
[[ -z "$SKILL_NAME" ]] && exit 0

# Heavy skills that consume significant context
HEAVY_SKILLS="build fix orchestrate l-thread ship refactor teams"

# Check if the recorded skill is a heavy one
IS_HEAVY=false
for skill in $HEAVY_SKILLS; do
    if [[ "$SKILL_NAME" == "$skill" ]]; then
        IS_HEAVY=true
        break
    fi
done

[[ "$IS_HEAVY" != true ]] && exit 0

# Output the reminder
echo ""
echo "[Hook] Consider running /compact -- this was a context-heavy operation ($SKILL_NAME)."

exit 0
