---
name: type-check
trigger: post-edit
description: Runs TypeScript type checking on modified files
enabled: true
filePatterns: ["*.ts", "*.tsx"]
mode: incremental
---

**Purpose:** Catch type errors immediately after editing.

**Behavior:**

```
ON post_edit:
  IF file_is_typescript:
    RUN tsc --noEmit on_file
    
    IF errors_found:
      REPORT type_errors
      SUGGEST fixes
```

**Commands:**

```bash
# Check single file (approximate - tsc checks all)
bun tsc --noEmit

# Watch mode (for ongoing development)
bun tsc --noEmit --watch

# With specific config
bun tsc --noEmit -p tsconfig.json
```

**Output (Clean):**

```markdown
✓ Type check passed for `src/component.tsx`
```

**Output (Errors):**

```markdown
✗ Type errors in `src/component.tsx`

## Errors
1. **Line 15, Col 10**
   ```
   Type 'string' is not assignable to type 'number'
   ```
   ```tsx
   const count: number = "5" // Error here
   ```
   **Fix:** Convert string to number or change type

2. **Line 23, Col 5**
   ```
   Property 'onClick' is missing in type '{}'
   ```
   ```tsx
   <Button /> // Missing required prop
   ```
   **Fix:** Add onClick prop: `<Button onClick={handleClick} />`

## Quick Fixes
- Line 15: `const count: number = parseInt("5", 10)`
- Line 23: `<Button onClick={() => {}} />`
```

**Common Patterns:**

| Error | Typical Fix |
|-------|-------------|
| `any` not allowed | Use `unknown` and narrow |
| Missing property | Add required prop/field |
| Type mismatch | Cast or convert type |
| Null check | Add optional chaining `?.` |
