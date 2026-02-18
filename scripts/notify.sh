#!/bin/bash
# Notification Hook
# Sends system notification when Claude needs attention

# macOS notification (use argv to prevent AppleScript injection)
if command -v osascript &> /dev/null; then
    osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title "Claude Code"' -e 'end run' -- "$NOTIFICATION_MESSAGE"
fi

# Linux notification (if notify-send available)
if command -v notify-send &> /dev/null; then
    notify-send "Claude Code" "$NOTIFICATION_MESSAGE"
fi
