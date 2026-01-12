---
name: test-watcher
trigger: post-edit
description: Runs related tests automatically when files change
enabled: false
runMode: related
timeout: 30000
---

**Purpose:** Ensure changes don't break existing functionality.

**Behavior:**

```
ON post_edit:
  FIND related_tests for_changed_file
  
  IF related_tests_exist:
    RUN tests with_timeout
    REPORT results
  ELSE:
    SUGGEST create_tests
```

**Test Discovery:**

```
For: src/components/Button.tsx
Look for:
  - src/components/Button.test.tsx
  - src/components/__tests__/Button.test.tsx
  - tests/components/Button.test.tsx
  - **/*.test.{ts,tsx} containing "Button"
```

**Commands:**

```bash
# Run specific test file
bun test src/components/Button.test.tsx

# Run tests matching pattern
bun test --grep "Button"

# Run with coverage for file
bun test --coverage src/components/Button.test.tsx
```

**Output (Pass):**

```markdown
✓ Tests passed for `Button.tsx`

## Results
- Button.test.tsx: 5/5 passing
- Duration: 1.2s
```

**Output (Fail):**

```markdown
✗ Tests failed for `Button.tsx`

## Failures
- Button.test.tsx:
  ✗ "should render correctly"
    Expected: <button>Click</button>
    Received: <button>Submit</button>

## Suggested Fix
Check line 15 in Button.tsx - button text may have changed.
```

**Output (No Tests):**

```markdown
⚠️ No tests found for `Button.tsx`

## Suggested Test Locations
- src/components/Button.test.tsx
- src/components/__tests__/Button.test.tsx

## Generate Tests?
Use `/test Button` to scaffold tests for this component.
```
