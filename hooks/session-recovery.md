---
name: session-recovery
trigger: session-start, on-error
description: Automatically recovers from errors and crashes, restoring session state
enabled: true
autoResume: true
maxRetries: 3
---

**Purpose:** Ensure continuity and prevent lost work from crashes or errors.

**Behavior:**

1. **On session start:**
   - Check for previous session state
   - Detect if last session ended abnormally
   - Offer to restore context

2. **On error:**
   - Capture error context
   - Attempt automatic recovery
   - Preserve work in progress

**Recovery Actions:**

```
ON session_start:
  IF previous_session_exists AND abnormal_termination:
    LOAD session_state
    RESTORE todo_list
    DISPLAY "Recovered from previous session"
    SUMMARIZE where_we_left_off
    
ON error:
  CAPTURE error_context
  SAVE current_state
  
  IF recoverable_error:
    RETRY with_backoff (max 3 attempts)
  ELSE:
    PRESERVE work_in_progress
    NOTIFY user_of_failure
    SUGGEST recovery_steps
```

**Session State Preserved:**

- Current todo list and progress
- Files being edited
- Conversation context summary
- Last successful checkpoint
- Pending operations

**Output on Recovery:**

```markdown
🔄 Session Recovery

## Previous Session Detected
Last active: [timestamp]
Status: Abnormal termination

## Restored State
- 3 pending todos
- 2 files in progress
- Last checkpoint: "Implementing feature X"

## Where We Left Off
[Summary of last activity]

## Continue?
Ready to resume from last checkpoint.
```

**Error Recovery Output:**

```markdown
⚠️ Error Encountered

## Error Details
Type: [Error type]
Message: [Error message]

## Recovery Attempt
Attempt 1/3: Retrying operation...
✓ Recovery successful

## Continuing...
[Resuming from last stable state]
```
