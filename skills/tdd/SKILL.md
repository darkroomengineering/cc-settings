---
name: tdd
description: |
  Use when:
  - User says "TDD", "test-first", "red-green-refactor"
  - User wants tests to drive design, not just verify it
  - Building a non-trivial feature where the interface isn't obvious
  - Fixing a bug that should never recur (write the failing test first)
  - User wants integration-style tests that survive refactors

  Test-driven development with strict red → green → refactor discipline.
  Sibling to `/build` (which scaffolds tests after implementation).
  Use this when you want tests to drive the design, or when the failure
  mode is "tests pass but behavior is wrong."
---

# TDD — red → green → refactor

A test-first discipline that produces tests which describe **behavior** through public interfaces, not implementation. Such tests survive refactors. Tests coupled to internals do not — they break the moment you rename a function and pass when behavior actually breaks.

Before exploring the codebase, follow [../context-doc/DOMAIN-AWARENESS.md](../context-doc/DOMAIN-AWARENESS.md). Test names and interface vocabulary should match the project's `CONTEXT.md`.

## Anti-pattern: horizontal slices

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

## Workflow

### 1. Plan

Before writing any code:

- Confirm with the user what interface changes are needed
- Confirm which behaviors to test (prioritize — you can't test everything)
- List the **behaviors** to test (not implementation steps)
- Get user approval on the plan

Ask: *"What should the public interface look like? Which behaviors are most important?"*

### 2. Tracer bullet

Write **one** test confirming **one** thing about the system:

```
RED:   test for first behavior → fails
GREEN: minimal code to pass → passes
```

This proves the path works end-to-end. Don't move on until it passes.

### 3. Incremental loop

For each remaining behavior:

```
RED:   next test → fails
GREEN: minimal code to pass → passes
```

Rules:

- One test at a time
- Only enough code to pass the current test
- Don't anticipate future tests
- Keep tests focused on observable behavior

### 4. Refactor

After all tests pass, look for cleanup:

- Extract duplication
- Deepen modules — move complexity behind simple interfaces
- Apply naming from `CONTEXT.md`
- Run the full test suite after each refactor step

**Never refactor while red.** Get to green first.

## Per-cycle checklist

- [ ] Test describes behavior, not implementation
- [ ] Test uses only the public interface
- [ ] Test would survive an internal refactor
- [ ] Code is minimal for this test
- [ ] No speculative features added

## When TDD is the wrong tool

- One-shot scripts, prototypes, throwaway exploration
- UI work where the "behavior" is visual and a snapshot/visual test is more useful
- Code where the public interface is dictated by an external spec (just write the conformance test, then implement)

For these, use `/build` (scaffold-then-test) or `/fix` (existing-bug pipeline) instead.
