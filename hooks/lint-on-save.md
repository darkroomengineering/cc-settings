---
name: lint-on-save
trigger: post-edit
description: Automatically runs linter after file modifications
enabled: false
status: guideline
autoFix: true
filePatterns: ["*.ts", "*.tsx", "*.js", "*.jsx"]
---

> **Note**: This is a behavioral guideline, not an automated hook. No script is registered in settings.json.

**Purpose:** Catch and fix lint errors immediately after editing.

**Behavior:**

```
ON post_edit:
  IF file_matches_pattern:
    RUN biome_check on_file
    
    IF errors_found AND autoFix_enabled:
      ATTEMPT auto_fix
      REPORT fixes_applied
    ELSE IF errors_found:
      REPORT errors
```

**Commands:**

```bash
# Check single file
bun biome check path/to/file.ts

# Auto-fix
bun biome check --fix path/to/file.ts

# Format
bun biome format --write path/to/file.ts
```

**Output (Clean):**

```markdown
✓ Lint check passed for `src/component.tsx`
```

**Output (With Fixes):**

```markdown
🔧 Auto-fixed 2 issues in `src/component.tsx`

## Fixes Applied
- Line 15: Added missing semicolon
- Line 23: Removed unused import

File is now clean.
```

**Output (Manual Fix Needed):**

```markdown
⚠️ Lint errors in `src/component.tsx`

## Errors (cannot auto-fix)
- Line 15: `any` type is not allowed
- Line 42: Function too complex (cyclomatic complexity > 10)

## Suggestions
1. Replace `any` with proper type or `unknown`
2. Break down complex function into smaller functions
```
