---
name: dependency-check
trigger: post-edit
description: Validates that imported modules exist and are installed
enabled: false
status: guideline
filePatterns: ["*.ts", "*.tsx"]
---

> **Note**: This is a behavioral guideline, not an automated hook. No script is registered in settings.json.

**Purpose:** Catch missing dependencies early.

**Behavior:**

```
ON post_edit:
  EXTRACT imports from_file
  
  FOR each_import:
    IF external_package:
      CHECK exists in_node_modules
      CHECK exists in_package_json
    ELSE IF local_import:
      CHECK file_exists
      
  REPORT missing_dependencies
```

**Checks:**

1. **External packages** - Verify in `node_modules` and `package.json`
2. **Local imports** - Verify file path exists
3. **Type imports** - Verify `@types/*` packages if needed
4. **Alias imports** - Resolve `@/` paths correctly

**Output (Clean):**

```markdown
✓ All dependencies valid for `src/component.tsx`
```

**Output (Missing External):**

```markdown
⚠️ Missing dependencies in `src/component.tsx`

## Missing Packages
- `framer-motion` - Not installed

## Install Command
```bash
bun add framer-motion
```

## Or if dev dependency:
```bash
bun add -d framer-motion
```
```

**Output (Missing Local):**

```markdown
⚠️ Missing local imports in `src/component.tsx`

## Missing Files
- `./utils/helpers` - File not found
  Checked: src/utils/helpers.ts, src/utils/helpers/index.ts

## Suggestions
1. Create the missing file
2. Fix the import path
3. Check for typos in the path
```

**Output (Missing Types):**

```markdown
⚠️ Missing type definitions

## Missing @types Packages
- `@types/lodash` - Types not found for `lodash`

## Install Command
```bash
bun add -d @types/lodash
```
```
