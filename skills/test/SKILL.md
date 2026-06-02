---
name: test
description: Write/run tests, check coverage, or TDD discipline. Triggers "test", "write tests", "add tests", "run tests", "coverage", "unit test", "integration test", "TDD", "test-first", "red-green-refactor", "bugs-that-must-not-recur"; post-implementation, pre-merge.
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

---

## Variant: TDD (test-first discipline)

A test-first discipline that produces tests which describe **behavior** through public interfaces, not implementation. Such tests survive refactors. Tests coupled to internals do not — they break the moment you rename a function and pass when behavior actually breaks.

Before exploring the codebase, follow [../context-doc/DOMAIN-AWARENESS.md](../context-doc/DOMAIN-AWARENESS.md). Test names and interface vocabulary should match the project's `CONTEXT.md`.

### Anti-pattern: horizontal slices

**Do not write all tests first, then all implementation.** That produces tests describing *imagined* behavior. They test the *shape* of things (data structures, function signatures) instead of user-facing capability. They go insensitive to real changes — they pass when behavior breaks and fail when behavior is fine.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED→GREEN: test1 → impl1
  RED→GREEN: test2 → impl2
  ...
```

Each cycle responds to what you learned from the previous one. You can only write the right test for behavior `N` after implementing behavior `N−1`.

### Workflow

#### 1. Plan

Before writing any code:

- Confirm with the user what interface changes are needed
- Confirm which behaviors to test (prioritize — you can't test everything)
- List the **behaviors** to test (not implementation steps)
- Get user approval on the plan

Ask: *"What should the public interface look like? Which behaviors are most important?"*

#### 2. Tracer bullet

Write **one** test confirming **one** thing about the system:

```
RED:   test for first behavior → fails
GREEN: minimal code to pass → passes
```

This proves the path works end-to-end. Don't move on until it passes.

#### 3. Incremental loop

For each remaining behavior:

```
RED:   next test → fails
GREEN: minimal code to pass → passes
```

To run the red→green cycle autonomously across turns, set
`/goal every planned behavior has a passing test and the full suite exits 0`.
The evaluator reads the test output from the transcript after each turn — don't
phrase the condition as something only the runtime can prove (file flags, etc.).

Rules:

- One test at a time
- Only enough code to pass the current test
- Don't anticipate future tests
- Keep tests focused on observable behavior

#### 4. Refactor

After all tests pass, look for cleanup:

- Extract duplication
- Deepen modules — move complexity behind simple interfaces
- Apply naming from `CONTEXT.md`
- Run the full test suite after each refactor step

**Never refactor while red.** Get to green first.

### Per-cycle checklist

- [ ] Test describes behavior, not implementation
- [ ] Test uses only the public interface
- [ ] Test would survive an internal refactor
- [ ] Code is minimal for this test
- [ ] No speculative features added

### When TDD is the wrong tool

- One-shot scripts, prototypes, throwaway exploration
- UI work where the "behavior" is visual and a snapshot/visual test is more useful
- Code where the public interface is dictated by an external spec (just write the conformance test, then implement)

For these, use `/build` (scaffold-then-test) or `/fix` (existing-bug pipeline) instead.
