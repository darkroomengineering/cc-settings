---
name: explore
description: Explore and navigate the codebase efficiently
arguments:
  - name: target
    description: File, directory, or pattern to explore
    required: false
---

**Usage:** `/explore [target]`

**Examples:**
- `/explore` - Overview of entire project structure
- `/explore components/` - Deep dive into components directory
- `/explore Button` - Find all Button-related code
- `/explore auth` - Explore authentication flow

**Behavior:**

1. **No argument** - Full project architecture overview
   ```
   - Map directory structure
   - Identify key entry points
   - List major patterns in use
   - Highlight important files
   ```

2. **Directory argument** - Deep dive into directory
   ```
   - List all files with purposes
   - Identify patterns and conventions
   - Map internal dependencies
   - Note any inconsistencies
   ```

3. **Search argument** - Find related code
   ```
   - Search file names
   - Search content
   - Group by relevance
   - Show usage patterns
   ```

**Output Format:**

```markdown
## Exploration: [target]

### Structure
[Directory tree or file list]

### Key Files
- `path/file.ts` - [Purpose]

### Patterns Detected
- [Pattern 1]: Used in [locations]

### Dependencies
- Internal: [List]
- External: [List]

### Recommendations
- [Any suggestions for navigation]
```

**Delegates to:** `explore` agent
