#!/usr/bin/env bash
# PostCompact hook — remind Claude to recover context after compaction
#
# After compaction, Claude loses context. This hook injects a reminder
# to re-read the active plan and key files.

echo "[PostCompact] Context was compacted. Recovery steps:"
echo "  1. Re-read your active task plan (check plans/ directory)"
echo "  2. Re-read any files you were actively editing"
echo "  3. Check TaskList for current progress"
echo "  4. Resume from where you left off"

# If a handoff was saved pre-compact, point to it
HANDOFF_DIR="$HOME/.claude/handoffs"
if [ -d "$HANDOFF_DIR" ]; then
  LATEST=$(ls -t "$HANDOFF_DIR"/*.md 2>/dev/null | head -1)
  if [ -n "$LATEST" ]; then
    echo "  5. Handoff saved: $LATEST"
  fi
fi
