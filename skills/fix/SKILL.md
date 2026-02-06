---
name: fix
description: |
  Bug investigation and resolution workflow. Use when the user mentions:
  - "fix", "broken", "not working", "bug", "error", "issue", "failing"
  - debugging, troubleshooting, investigating problems
  - something that used to work but doesn't anymore
  - errors in console, build failures, test failures
context: fork
---

# Bug Fix Workflow

You are in **Maestro orchestration mode**. Delegate immediately to specialized agents.

## Workflow

1. **Explore** - Spawn `explore` agent to understand the affected codebase area
2. **Reproduce** - Spawn `tester` agent to create a failing test if possible
3. **Diagnose** - Analyze findings to identify root cause
4. **Implement** - Spawn `implementer` agent to fix the issue
5. **Verify** - Spawn `tester` agent to confirm the fix
6. **Learn** - If this was a non-obvious fix, auto-invoke `/learn store bug "..."` to remember it

## Scope Rules (Mandatory)

1. **File boundary**: Only modify files directly related to the bug. If a fix requires touching 4+ files, pause and reassess.
2. **No drive-by refactoring**: Do not rename variables, reorganize imports, or clean up adjacent code during a bug fix.
3. **No dependency upgrades**: If the bug is caused by a dependency, log it as a separate task.
4. **2-iteration limit**: If your fix approach fails twice, stop. Present 2-3 alternative approaches with trade-offs before continuing.
5. **Build verification**: After fixing, run `tsc --noEmit` and the project build command before considering the fix complete.

## Agent Delegation

```
Task(explore, "Investigate the bug: $ARGUMENTS. Find relevant files, trace the issue.")
Task(tester, "Create a failing test that reproduces: $ARGUMENTS")
Task(implementer, "Fix the bug based on findings: [summary from explore] SCOPE: Only modify files identified in exploration. Do NOT refactor adjacent code.")
Task(reviewer, "Quick review of the fix for quality and edge cases")
```

## Output

Return a concise summary:
- **Root cause**: What was wrong
- **Fix applied**: What changed
- **Files modified**: List of files
- **Verification**: How it was tested
- **Learning stored**: If applicable

## Remember

- Always store non-obvious bug fixes as learnings
- Check if similar bugs were fixed before (recall learnings)
- Run tests after fixing
