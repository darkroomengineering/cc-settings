---
name: learn
description: Manage persistent learnings across sessions
usage: /learn <action> [args]
---

# /learn - Memory System

Manage persistent learnings that survive across Claude Code sessions.

## Actions

### Store a new learning
```
/learn store <category> <learning> [context]
```

**Categories:**
- `bug` - Bug fixes and debugging insights
- `pattern` - Code patterns that work well
- `gotcha` - Gotchas and edge cases
- `tool` - Tool/library usage tips
- `perf` - Performance optimizations
- `config` - Configuration discoveries
- `arch` - Architecture decisions
- `test` - Testing insights

**Examples:**
```
/learn store bug "useAuth causes hydration error - use dynamic import"
/learn store pattern "Wrap async server components in Suspense" "app/page.tsx"
/learn store gotcha "Biome ignores .mdx files by default"
/learn store tool "Use bun --bun flag for native Bun APIs"
```

### Recall learnings
```
/learn recall [filter] [value]
```

**Filters:**
- `all` - Show all learnings for current project
- `all-projects` - List all projects with learnings
- `category <cat>` - Filter by category
- `project <name>` - View a different project's learnings
- `search <keyword>` - Search in learning text
- `recent [n]` - Show n most recent

**Examples:**
```
/learn recall all
/learn recall all-projects
/learn recall category bug
/learn recall project other-app
/learn recall search hydration
/learn recall recent 5
```

### Delete a learning
```
/learn delete <id>
```

## Auto-Recall on Session Start

When you start a new Claude Code session, the system automatically:
1. Checks for learnings related to the current project
2. Displays the 3 most recent project learnings
3. Shows total learning counts

## When to Store Learnings

Store a learning when you discover:
- **Bugs**: A fix that wasn't obvious
- **Patterns**: A code pattern that works well in this codebase
- **Gotchas**: Something that caused confusion or wasted time
- **Tools**: A useful flag or feature in a tool/library
- **Performance**: An optimization that made a difference
- **Config**: A configuration setting that solved a problem
- **Architecture**: A design decision and its rationale
- **Testing**: A testing insight or useful test pattern

## Storage Location

Learnings are stored **per-project**:

```
~/.claude/learnings/
├── my-app/
│   └── learnings.json
├── other-project/
│   └── learnings.json
└── team-config/
    └── learnings.json
```

Each project's learnings are isolated and can be:
- Backed up independently
- Shared across machines
- Manually edited if needed

View all projects: `recall-learnings.sh all-projects`
