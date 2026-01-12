---
name: docs
description: Fetch documentation for libraries, frameworks, or project code
arguments:
  - name: topic
    description: Library name, API, or code concept to document
    required: true
---

**Usage:** `/docs <topic>`

**Examples:**
- `/docs react-query` - Fetch React Query documentation
- `/docs useEffect` - Explain useEffect hook
- `/docs framer-motion` - Framer Motion API reference
- `/docs our Button component` - Document local Button component

**Behavior:**

1. **External library** - Fetch official docs
   ```
   - Search for official documentation
   - Find relevant API sections
   - Locate code examples
   - Note version-specific info
   ```

2. **React/Next.js API** - Explain with examples
   ```
   - Official documentation summary
   - Common patterns
   - Gotchas and best practices
   - Code examples from codebase
   ```

3. **Local code** - Generate documentation
   ```
   - Read the source code
   - Document purpose and API
   - Find usage examples
   - Note dependencies
   ```

**Output Format:**

```markdown
## Documentation: [topic]

### Overview
[Brief description]

### API Reference
[Key methods/props/functions]

### Usage Examples
```tsx
// Example code
```

### Common Patterns
- [Pattern 1]
- [Pattern 2]

### Gotchas
- [Things to watch out for]

### Related
- [Related topics/APIs]

### Sources
- [Links to official docs]
```

**Delegates to:** `librarian` agent
