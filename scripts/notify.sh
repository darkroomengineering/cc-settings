#!/bin/bash
# Notification Hook
# Sends system notification when Claude needs attention

# macOS notification
if command -v osascript &> /dev/null; then
    osascript -e "display notification \"$NOTIFICATION_MESSAGE\" with title \"Claude Code\""
fi

# Linux notification (if notify-send available)
if command -v notify-send &> /dev/null; then
    notify-send "Claude Code" "$NOTIFICATION_MESSAGE"
fi
