---
name: pre-commit-check
trigger: pre-commit
description: Validates code quality and standards before allowing git commits
enabled: true
---

**Purpose:** Ensure code quality standards are met before committing.

**Checks Performed:**

1. **Linting** - Run Biome/ESLint
2. **Type checking** - TypeScript compilation
3. **Tests** - Run affected tests
4. **Format** - Check formatting
5. **Secrets** - Scan for exposed credentials
6. **TODOs** - Check for incomplete markers

**Behavior:**

```
ON pre_commit:
  RUN lint_check
  RUN type_check
  RUN test_affected
  RUN format_check
  RUN secret_scan
  
  IF any_check_fails:
    BLOCK commit
    DISPLAY failures
    SUGGEST fixes
  ELSE:
    ALLOW commit
```

**Commands Used:**

```bash
# Linting
bun biome check .

# Type checking
bun tsc --noEmit

# Tests (affected only)
bun test --changed

# Format check
bun biome format --check .

# Secret scan
grep -r "PRIVATE_KEY\|API_KEY\|SECRET" --include="*.ts" --include="*.tsx"
```

**Output:**

```markdown
🔍 Pre-Commit Check

## Results
✓ Linting passed
✓ Types valid
✓ Tests passing (12/12)
✓ Formatting correct
✓ No secrets detected

## Ready to Commit
All checks passed. Proceeding with commit.
```

**On Failure:**

```markdown
🚫 Pre-Commit Check Failed

## Failures
✗ Linting: 3 errors
  - src/component.tsx:15 - Unused variable
  - src/utils.ts:42 - Missing return type
  
✗ Types: 1 error
  - src/api.ts:23 - Type mismatch

## Auto-Fix Available
Run `bun biome check --fix` to fix linting issues.

## Block Commit
Fix the above issues before committing.
```
