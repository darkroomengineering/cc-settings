#!/bin/bash
# Create Handoff Script
# Saves current session state for resumption

HANDOFF_DIR="${HOME}/.claude/handoffs"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
HANDOFF_FILE="${HANDOFF_DIR}/handoff_${TIMESTAMP}.json"

mkdir -p "$HANDOFF_DIR"

PROJECT_DIR=$(pwd)
PROJECT_NAME=$(basename "$PROJECT_DIR")

GIT_BRANCH=""
GIT_STATUS=""
if git rev-parse --git-dir > /dev/null 2>&1; then
    GIT_BRANCH=$(git branch --show-current 2>/dev/null)
    GIT_STATUS=$(git status --porcelain 2>/dev/null | head -20)
fi

cat > "$HANDOFF_FILE" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "project": {
    "name": "$PROJECT_NAME",
    "path": "$PROJECT_DIR"
  },
  "git": {
    "branch": "$GIT_BRANCH",
    "pendingChanges": $(echo "$GIT_STATUS" | wc -l | tr -d ' ')
  },
  "context": {
    "summary": "",
    "activeTodos": [],
    "keyFiles": [],
    "currentTask": ""
  },
  "notes": ""
}
EOF

HANDOFF_MD="${HANDOFF_DIR}/handoff_${TIMESTAMP}.md"
cat > "$HANDOFF_MD" << EOF
# Session Handoff - ${TIMESTAMP}

## Project
- **Name:** ${PROJECT_NAME}
- **Path:** ${PROJECT_DIR}
- **Branch:** ${GIT_BRANCH}

## Pending Changes
\`\`\`
${GIT_STATUS}
\`\`\`

## Session Summary
<!-- Add summary of what was accomplished -->

## Active Todos
<!-- List any incomplete tasks -->

## Key Files
<!-- List important files for context -->

## Current Task
<!-- Describe what you were working on -->

## Notes for Next Session
<!-- Any important context for resuming -->

---
*Created: $(date)*
*Resume with: \`/resume-handoff ${TIMESTAMP}\`*
EOF

ln -sf "$HANDOFF_FILE" "${HANDOFF_DIR}/latest.json"
ln -sf "$HANDOFF_MD" "${HANDOFF_DIR}/latest.md"

echo ""
echo "✅ HANDOFF CREATED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📁 Files:"
echo "   JSON: $HANDOFF_FILE"
echo "   MD:   $HANDOFF_MD"
echo ""
echo "📋 Next Steps:"
echo "   1. Fill in the session summary in the .md file"
echo "   2. List active todos and key files"
echo "   3. Note current task for context"
echo ""
echo "🔄 Resume Command:"
echo "   /resume-handoff ${TIMESTAMP}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit 0
