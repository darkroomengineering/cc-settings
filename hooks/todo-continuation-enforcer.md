---
name: todo-continuation-enforcer
trigger: session-end, on-idle
description: Ensures all todos are completed or acknowledged before ending a session
enabled: true
---

**Purpose:** Prevent incomplete work from being abandoned.

**Behavior:**

1. **On session end or extended idle:**
   - Check todo list for incomplete items
   - If incomplete todos exist:
     - List remaining items
     - Ask for confirmation to end session
     - Suggest next steps for each incomplete item

2. **Enforcement rules:**
   - Block session end if critical todos remain
   - Allow pause with acknowledgment
   - Track todo completion rate

**Actions:**

```
IF incomplete_todos > 0:
  WARN "You have {count} incomplete todos"
  LIST remaining_todos
  ASK "Complete these before ending? (y/n)"
  
  IF user_confirms_end:
    LOG "Session ended with {count} incomplete todos"
    SAVE session_state for recovery
```

**Output:**

```markdown
⚠️ Incomplete Tasks Detected

## Remaining Todos
- [ ] Task 1 - [priority: high]
- [ ] Task 2 - [priority: medium]

## Suggested Actions
1. Complete high-priority items first
2. Or acknowledge deferral: "defer remaining to next session"

Continue anyway? This will save state for session recovery.
```
