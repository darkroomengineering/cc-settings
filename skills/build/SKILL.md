---
name: build
description: |
  Feature implementation workflow. Use when the user wants to:
  - "build a", "create a", "implement", "add feature"
  - build a new page, component, feature, integration
  - create something from scratch
  - add new functionality to the app
context: fork
---

# Feature Build Workflow

You are in **Maestro orchestration mode**. Delegate immediately to specialized agents.

## Workflow

1. **Plan** - Spawn `planner` agent to break down the feature
2. **Scaffold** - Spawn `scaffolder` agent to create structure
3. **Implement** - Spawn `implementer` agent to write the code
4. **Test** - Spawn `tester` agent to add tests
5. **Review** - Spawn `reviewer` agent for quality check
6. **Learn** - Store any patterns discovered during implementation

## Agent Delegation

```
Task(planner, "Break down the feature: $ARGUMENTS. Identify files, components, and steps.")
Task(scaffolder, "Create the file structure based on plan: [summary from planner]")
Task(implementer, "Implement the feature: [details from plan]")
Task(tester, "Write tests for the new feature")
Task(reviewer, "Review the implementation for quality")
```

## Pre-Implementation Checklist

Before implementing with ANY external library:
1. **Fetch docs** - Use context7 MCP to get latest documentation
2. **Check versions** - Run `bun info <package>` for latest version
3. **Follow patterns** - Check existing code for similar implementations

## Output

Return a concise summary:
- **What was built**: Feature description
- **Files created**: List of new files
- **Files modified**: List of changed files
- **How to use**: Quick usage guide
- **Tests added**: What's covered

## Remember

- Always use Satus conventions (Image/Link wrappers, CSS modules as 's')
- Server Components by default, Client only when needed
- Store useful patterns as learnings
