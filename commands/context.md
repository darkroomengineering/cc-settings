---
name: context
description: Manage context window - check usage, compact, or start fresh
arguments:
  - name: action
    description: Action to perform (status, compact, fresh, save)
    required: false
---

**Usage:** `/context [action]`

**Actions:**
- `/context` or `/context status` - Show current context usage
- `/context compact` - Summarize and prune old context
- `/context fresh` - Start new context with summary handoff
- `/context save` - Save current state for recovery

**Behavior:**

### Status (default)
```markdown
## Context Window Status

Usage: ████████░░ 73% (~73,000 / 100,000 tokens)

### Breakdown
- Conversation: 45%
- Tool outputs: 20%
- File contents: 8%

### Recommendations
[Based on usage level]
```

### Compact
```
1. Summarize old conversation turns
2. Prune stale file contents
3. Collapse resolved discussions
4. Remove redundant tool outputs
5. Report space recovered
```

Output:
```markdown
## Context Compacted

Recovered: ~15,000 tokens (15%)
New usage: ██████░░░░ 58%

### Actions Taken
- Summarized 12 conversation turns
- Pruned 5 stale file reads
- Collapsed 3 resolved threads
```

### Fresh
```
1. Create summary of current session
2. Note important context to preserve
3. List active todos
4. Start new context
5. Inject summary
```

Output:
```markdown
## Fresh Context Started

### Preserved Context
- Active todos: 3
- Key files: [list]
- Current task: [description]

### Summary Handoff
[Compressed summary of previous session]

Ready to continue with clean context.
```

### Save
```
1. Capture current state
2. Save todos and progress
3. Note conversation summary
4. Store for recovery
```

Output:
```markdown
## Context Saved

Checkpoint: [timestamp]
Todos: 3 active
Files: 5 in progress

Recovery command: `/context restore [checkpoint-id]`
```

**Triggers:** `context-window-monitor` hook

**Related Skills:**
- `/create-handoff` - Full session handoff (recommended at 80%+)
- `/resume-handoff` - Resume from previous handoff
- Skill activation auto-triggers `create_handoff` at 90%+
