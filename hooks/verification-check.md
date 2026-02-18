# Verification Check

Behavioral guideline for verifying work before claiming completion. Ensures no agent claims "done" without evidence.

## 5-Level Verification Stack

| Level | Check | Command | When Required |
|-------|-------|---------|---------------|
| 1 | **Compile** | `npx tsc --noEmit` | Always (TypeScript projects) |
| 2 | **Lint** | `bunx biome check [files]` | Always |
| 3 | **Test** | `bun test --filter="[pattern]"` | When tests exist for modified code |
| 4 | **UI Screenshot** | `agent-browser screenshot` | After visual component changes |
| 5 | **Integration** | `bun test:e2e` | Before PR, after major features |

Levels 1-2 are mandatory. Levels 3-5 depend on context.

## Completion Promise Pattern

After ALL verification passes, output:

```markdown
## Verification Summary
- [x] TypeScript compiles
- [x] Biome lint passes
- [x] Related tests pass (N/N)
- [x] [other checks as applicable]

<promise>COMPLETE</promise>
```

The `<promise>COMPLETE</promise>` tag signals verified completion to orchestrating agents.

## Per-Agent Verification Requirements

| Agent | Required Levels | Notes |
|-------|----------------|-------|
| **implementer** | 1, 2, 3 | Must compile, lint, and pass related tests |
| **scaffolder** | 1, 2 | Must compile and lint generated code |
| **tester** | 1, 3 | Tests must compile and pass |
| **reviewer** | None | Reviews others' verification |
| **explore** | None | Read-only, no verification needed |
| **planner** | None | Planning only, no code changes |

## When to Skip Verification

- **Documentation-only changes**: No compile/lint needed for `.md` files
- **Config changes**: Lint only, skip tests unless config affects behavior
- **Explore/review agents**: Read-only work, no verification needed

## Failure Handling

### Never claim completion if verification fails

```
WRONG:
  "Done! (there's a type error but it should be fine)"
  <promise>COMPLETE</promise>

CORRECT:
  "Level 1 (compile) failed: type error in src/foo.ts:42"
  → Fix the error
  → Re-run verification
  → Only then: <promise>COMPLETE</promise>
```

### Failure Recovery Steps

1. Identify which level failed
2. Read the error output
3. Fix the issue
4. Re-run ALL levels (not just the failed one)
5. Only output promise after all pass

### Persistent Failures

If a verification level fails 3+ times:
1. Stop attempting fixes
2. Report the failure with full error output
3. Ask for human guidance
4. Do NOT output `<promise>COMPLETE</promise>`
