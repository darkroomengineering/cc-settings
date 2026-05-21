# Knowledge System

Two-tier knowledge management for AI-assisted development teams.

---

## Overview

| Tier | Storage | Scope | Access |
|------|---------|-------|--------|
| **Shared** | GitHub Project board | Team-wide | `gh api graphql` |
| **Local** | Auto-memory + learnings | Per-developer | File system |

**Shared knowledge** is for things the whole team benefits from knowing — architecture decisions, cross-cutting gotchas, resolved incidents, team conventions.

**Local knowledge** is for personal workflow preferences, individual learnings, and session context.

---

## Shared Knowledge (GitHub Projects)

### Setup

1. Create a GitHub Project on your repository:
   - Name: `Knowledge Base` (or similar)
   - Add custom fields:
     - **Type** (single select): `decision`, `convention`, `gotcha`, `incident`, `pattern`
     - **Tags** (text): free-form tags like `auth`, `api`, `css`, `performance`
     - **Added By** (text): who added it

2. Note the Project number (visible in the URL: `github.com/orgs/ORG/projects/NUMBER`)

3. Add to your project's `CLAUDE.local.md` or environment:
   ```
   Knowledge base: gh project #NUMBER on ORG/REPO
   ```

### What Goes in Shared Knowledge

| Type | Example |
|------|---------|
| `decision` | "Chose Lenis over native smooth-scroll for cross-browser consistency" |
| `convention` | "All API routes return `{ data, error }` shape" |
| `gotcha` | "Sanity API returns UTC dates — always convert to local before display" |
| `incident` | "Hydration mismatch from useAuth — fixed with dynamic import, ssr:false" |
| `pattern` | "Wrap async server components in Suspense with skeleton fallback" |

### Agent Usage

**Reading shared knowledge:**
```bash
# List all entries
gh project item-list NUMBER --owner ORG --format json

# AI agents can query this on session start or when exploring a new area
```

**Adding shared knowledge:**
```bash
# Via the share-learning skill
/share-learning gotcha "Biome ignores .mdx files by default"

# Manually via gh CLI
gh project item-create NUMBER --owner ORG --title "gotcha: Biome ignores .mdx" --body "Add .mdx to biome.json includes array"
```

### Best Practices

- Keep entries atomic — one learning per entry
- Include the **why**, not just the **what**
- Add tags for discoverability
- Review periodically — remove outdated entries
- If a gotcha gets fixed upstream, archive the entry

---

## Local Knowledge (Auto-Memory)

### How It Works

Claude Code's auto-memory is the single local store. Memories live at:
```
~/.claude/projects/<project-hash>/memory/
```

Each memory is a markdown file with frontmatter (`name`, `description`, `type`)
indexed from `MEMORY.md`. The auto-memory contract in `~/.claude/CLAUDE.md`
specifies four memory types (`user`, `feedback`, `project`, `reference`) and
when to write each. Memories persist across sessions and are recalled
automatically.

### What Goes in Local Knowledge

- Personal workflow preferences ("I prefer verbose commit messages") → `user`
- Corrections the user made to your approach → `feedback`
- Active project state, deadlines, blockers → `project`
- Pointers to external systems (Linear projects, dashboards) → `reference`

### Usage

The auto-memory writes on its own when triggers fire (see `~/.claude/CLAUDE.md`
"auto memory" section). To force a write, say "remember that ..." — Claude
files it under the matching type. To inspect or delete, edit the markdown
files in `~/.claude/projects/<project-hash>/memory/` directly.

The previous `/learn` skill (which wrote to `~/.claude/learnings/<project>/learnings.json`)
has been retired. Auto-memory replaces the local tier; `/share-learning` covers
the team-wide tier (above).

---

## Decision Guide

| Knowledge | Shared or Local? |
|-----------|-----------------|
| Architecture decision affecting the team | **Shared** |
| Bug fix that anyone might hit again | **Shared** |
| API quirk that affects all consumers | **Shared** |
| Your personal editor preferences | **Local** |
| A debugging trick specific to your OS | **Local** |
| Session state ("working on X") | **Local** |
| Team convention ("we use X pattern for Y") | **Shared** |
| Performance gotcha in a shared library | **Shared** |

**When in doubt:** if another team member's AI agent would benefit from knowing it, make it shared.

### Routing examples

```bash
# Architecture decision
gh project item-create "$KNOWLEDGE_PROJECT_NUMBER" --owner darkroomengineering \
  --title "decision: Lenis over native smooth-scroll" \
  --body "Cross-browser consistency. Native smooth-scroll diverges on Safari/Firefox; Lenis normalizes inertia + delta math. See ADR-007."

# Team convention
gh project item-create "$KNOWLEDGE_PROJECT_NUMBER" --owner darkroomengineering \
  --title "convention: API response shape" \
  --body "All API routes return { data, error } — never throw to the caller. Enforced by Biome rule in services/api/."

# Cross-cutting gotcha
gh project item-create "$KNOWLEDGE_PROJECT_NUMBER" --owner darkroomengineering \
  --title "gotcha: Sanity UTC dates" \
  --body "Sanity API returns UTC dates — always convert to local before display. Affects all date renderers."
```
