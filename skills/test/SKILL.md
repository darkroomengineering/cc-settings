---
name: test
description: |
  Use when:
  - User says "test", "write tests", "add tests", "run tests"
  - User mentions "coverage", "unit test", "integration test"
  - After implementing a feature (tests should follow)
  - Before shipping or merging code
context: fork
agent: tester
---

# Testing Workflow

Delegates to the Tester agent for test coverage and verification.

## Workflow

1. **Identify** - Determine what needs testing (component, hook, utility, integration)
2. **Write** - Create test files colocated with source (e.g., `button.test.tsx`)
3. **Run** - Execute tests and verify results
4. **Report** - Summarize coverage and gaps

## Testing Priorities

1. **Critical paths** - Auth, payments, core features
2. **Edge cases** - Error states, empty states, boundaries
3. **User interactions** - Forms, buttons, navigation
4. **Integration points** - API calls, external services

## Rationalization Counters

If you catch yourself thinking any of the following, STOP — you are skipping testing:

| Rationalization | Why It's Wrong |
|---|---|
| "This is too simple to test" | Simple functions with edge cases are exactly what tests catch |
| "I'll add tests later" | Later never comes; untested code ships and breaks |
| "The types guarantee correctness" | Types check structure, not logic — `add(a, b)` returning `a - b` passes TypeScript |
| "It's just UI, tests don't help" | Interaction tests catch regressions that visual review misses |
| "Manual testing is enough" | Manual testing doesn't run in CI and doesn't prevent regressions |
| "Tests are passing immediately" | Tests that pass on first run without failing first may not be testing what you think — verify the test actually exercises the code path |

## Red Flags

- **Tests pass immediately on first write**: Suspicious. Verify the test would fail if the implementation were wrong.
- **No assertions**: A test without assertions is not a test.
- **Mocking everything**: If you mock the thing you're testing, you're testing the mock.

## Output

Return a summary:
- **Tests written**: New test files/cases
- **Tests passing**: Status
- **Coverage**: Key areas covered
- **Gaps**: What still needs testing
