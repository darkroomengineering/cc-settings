#!/bin/bash
# Session Start Hook
# Runs when a new Claude Code session begins

# Log session start
echo "$(date '+%Y-%m-%d %H:%M:%S') - Session started in $(pwd)" >> ~/.claude/sessions.log

# Show welcome message (optional)
# echo "🚀 Darkroom Claude Code session started"
