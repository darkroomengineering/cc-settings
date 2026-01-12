---
name: create-handoff
description: Create a session handoff to preserve state before ending or context compaction
arguments: []
---

**Usage:** `/create-handoff`

**Purpose:** Preserve session state for seamless resumption. Critical at context limits.

**When to Use:**
- Before ending a session ("done for today")
- When context usage exceeds 80%
- Before manual context compaction
- When switching to a different task/project

**Behavior:**

```
1. Capture current state:
   - Project path and git branch
   - Pending git changes
   - Active todos
   - Key files in context
   
2. Create handoff files:
   - JSON: Machine-readable state
   - Markdown: Human-readable summary
   
3. Prompt for session summary:
   - What was accomplished
   - Current task in progress
   - Notes for next session
```

**Output:**

```markdown
✅ HANDOFF CREATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 Files:
   JSON: ~/.claude/handoffs/handoff_20240115_143022.json
   MD:   ~/.claude/handoffs/handoff_20240115_143022.md

📋 Next Steps:
   1. Fill in the session summary in the .md file
   2. List active todos and key files
   3. Note current task for context

🔄 Resume Command:
   /resume-handoff 20240115_143022

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Auto-Triggers:**
- `SessionEnd` hook
- `PreCompact` hook
- Context at 90%+ (via skill activation)

**Related:**
- `/resume-handoff` - Resume from handoff
- `/context` - Check context usage
