---
name: resume-handoff
description: Resume a session from a previous handoff
arguments:
  - name: handoff_id
    description: Timestamp ID of the handoff to resume (optional, defaults to latest)
    required: false
---

**Usage:** `/resume-handoff [handoff_id]`

**Purpose:** Continue work from a saved session state.

**When to Use:**
- Starting a new session after a break
- Recovering from context compaction
- Switching back to a previous project

**Behavior:**

```
1. Load handoff file:
   - If no ID provided, use latest handoff
   - If ID provided, find matching handoff
   
2. Display session context:
   - Previous project/branch
   - Session summary
   - Active todos
   - Current task
   - Notes from previous session
   
3. Suggest continuation actions
```

**Output:**

```markdown
🔄 RESUMING SESSION: 20240115_143022
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Session Handoff - 20240115_143022

## Project
- **Name:** my-project
- **Path:** /Users/dev/my-project
- **Branch:** feature/auth

## Session Summary
Implemented user authentication flow with OAuth...

## Active Todos
- [ ] Add refresh token handling
- [ ] Write tests for auth service

## Current Task
Working on the token refresh logic in auth.ts

## Notes for Next Session
Need to check rate limiting on OAuth provider

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Suggested Actions:
   1. Review the session summary above
   2. Continue from 'Current Task'
   3. Check off completed todos

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**List Available Handoffs:**

```bash
ls ~/.claude/handoffs/*.md
```

**Related:**
- `/create-handoff` - Create new handoff
- `/context` - Check context usage
