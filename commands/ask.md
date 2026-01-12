---
name: ask
description: Ask the Oracle for context-aware answers about the codebase
arguments:
  - name: question
    description: Your question about the codebase
    required: true
---

**Usage:** `/ask <question>`

**Examples:**
- `/ask how does authentication work?`
- `/ask where is the Button component used?`
- `/ask why is this function async?`
- `/ask what happens when a user submits the form?`
- `/ask is it safe to change this API?`

**Question Types:**

### "How does X work?"
```
- Traces execution flow
- Identifies key components
- Explains mechanism
```

### "Where is X?"
```
- Finds all locations
- Lists usage sites
- Maps dependencies
```

### "Why is X done this way?"
```
- Searches for rationale
- Checks git history
- Explains trade-offs
```

### "What happens when X?"
```
- Traces from trigger to effect
- Maps state changes
- Lists side effects
```

### "Is it safe to change X?"
```
- Finds all usages
- Checks test coverage
- Assesses risk
```

**Output Format:**

```markdown
## Answer: [Concise summary]

### Explanation
[Detailed explanation with code references]

### Key Files
- `path/file.ts:line` - [What it does]

### Evidence
[Code snippets supporting the answer]

### Caveats
- [Edge cases or exceptions]

### Related
- [Related concepts to explore]
```

**Delegates to:** `oracle` agent
