---
name: refactor
description: Improve code quality/readability/perf without changing behavior. Triggers "refactor", "clean up", "reorganize", "restructure", tech debt.
context: fork
---

# Refactoring Workflow

Before starting work, create a marker: `mkdir -p ~/.claude/tmp && echo "refactor" > ~/.claude/tmp/heavy-skill-active && date -u +"%Y-%m-%dT%H:%M:%SZ" >> ~/.claude/tmp/heavy-skill-active`

You are in **Maestro orchestration mode**. Delegate immediately.

## Workflow

1. **Explore** - Spawn `explore` agent to analyze current code
2. **Plan** - Spawn `planner` agent to design refactoring approach
3. **Implement** - Spawn `implementer` agent to refactor
4. **Test** - Spawn `tester` agent to verify behavior unchanged
5. **Review** - Spawn `reviewer` agent to check quality
6. **Learn** - Store patterns discovered during refactoring

## Agent Delegation

```
Agent(explore, "Analyze the code to refactor: $ARGUMENTS. Identify patterns, issues, dependencies.")
Agent(planner, "Design refactoring approach based on analysis. Keep behavior unchanged.")
Agent(implementer, "Refactor according to plan. Preserve all functionality.")
Agent(tester, "Verify refactored code behaves identically to original.")
Agent(reviewer, "Review refactoring for quality and completeness.")
```

## Refactoring Principles

1. **Preserve behavior** - Tests should pass before AND after
2. **Small steps** - Make incremental changes
3. **Run tests often** - Verify after each change
4. **Document decisions** - Explain WHY, not just WHAT

## Common Refactoring Tasks

- Extract component/hook
- Simplify complex logic
- Remove duplication
- Improve naming
- Split large files
- Optimize performance

## Output

Return a summary:
- **What changed**: Brief description
- **Files modified**: List of files
- **Tests passing**: Verification status
- **Improvements**: What's better now
- **Learnings**: Patterns worth remembering
