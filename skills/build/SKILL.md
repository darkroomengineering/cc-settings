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

Follow standard Maestro workflow: plan -> explore -> scaffold -> implement -> test -> review.

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
