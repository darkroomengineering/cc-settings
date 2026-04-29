---
name: learn
description: Save/recall learnings across sessions (bugs, patterns, gotchas, perf, config, arch). Auto-invoke after fixing non-obvious bugs. Triggers "remember this", "store learning", "what did we learn".
---

# Persistent Learning System

Store learnings that survive across sessions. **Proactively store when you discover something valuable.**

## Two Tiers

| Tier | Flag | Storage | Scope |
|------|------|---------|-------|
| **Local** | (default) | `~/.claude/learnings/<project>/` | Personal to this developer |
| **Shared** | `--shared` | GitHub Project board | Team-wide, all agents |

**Decision guide:** If another team member's AI agent would benefit from knowing it, use `--shared`.

## Auto-Store Triggers

Store automatically when:
- You fix a bug that wasn't immediately obvious
- You discover why something was breaking
- You find a workaround for a limitation
- You make a decision that future sessions should know about
- You encounter unexpected behavior
- You find a pattern that works well in this codebase

## Actions

### Store locally (default)
```bash
bun ~/.claude/src/scripts/learning.ts store "<category>" "<learning>" "[context]"
```

### Store to shared team knowledge
```bash
bun ~/.claude/src/scripts/learning.ts store --shared "<category>" "<learning>" "[context]"
```

This creates an entry in the project's GitHub Project board, accessible to any team member's AI agent. Requires `gh` CLI authenticated and a configured project number.

**Categories:** `bug`, `pattern`, `gotcha`, `tool`, `perf`, `config`, `arch`, `test`

**Examples:**
```bash
# Local: personal learning
bun ~/.claude/src/scripts/learning.ts store "bug" "useAuth hook causes hydration mismatch - wrap in dynamic import with ssr:false"

# Shared: team-wide gotcha
bun ~/.claude/src/scripts/learning.ts store --shared "gotcha" "Sanity API returns UTC dates - always convert to local before display"

# Shared: architecture decision
bun ~/.claude/src/scripts/learning.ts store --shared "arch" "Chose Lenis over native smooth-scroll for cross-browser consistency"

# Local: tool discovery
bun ~/.claude/src/scripts/learning.ts store "tool" "Use 'bun --bun' flag to enable native Bun APIs in scripts"
```

### Recall learnings
```bash
# Local learnings
bun ~/.claude/src/scripts/learning.ts recall [filter] [value]

# Shared team knowledge
bun ~/.claude/src/scripts/learning.ts recall shared
```

**Local filters:**
- `all` - All learnings for current project
- `all-projects` - List all projects with learnings
- `category <cat>` - Filter by category
- `search <keyword>` - Search in learning text
- `recent <n>` - Most recent n learnings

### Delete a learning
```bash
bun ~/.claude/src/scripts/learning.ts delete <id>
```

### Prune stale learnings
```bash
bun ~/.claude/src/scripts/learning.ts prune [days]
```

Surfaces learnings older than N days (default 90) for review. Stale learnings may reflect outdated patterns, deprecated APIs, or resolved issues. The command lists candidates — you confirm which to keep or delete.

**When to prune:**
- Start of a new project phase
- After major dependency upgrades
- When recalled learnings contradict current behavior
- Periodically (quarterly recommended)

## Storage

- **Local:** `~/.claude/learnings/<project>/learnings.json`
- **Shared:** GitHub Project board (see `docs/knowledge-system.md` for setup)

## Best Practices

1. **Be specific** - Include the actual fix, not just "fixed the bug"
2. **Include context** - What file, what component, what was the symptom
3. **Store immediately** - Don't wait until end of session
4. **Categorize correctly** - Helps with recall
5. **Use `--shared` for team knowledge** - Gotchas, decisions, conventions that affect everyone
6. **Keep local for personal stuff** - Workflow preferences, environment-specific notes
