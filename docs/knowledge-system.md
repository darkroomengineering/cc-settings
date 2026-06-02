# Knowledge System

Two-tier knowledge management for AI-assisted development teams.

---

## Overview

| Tier | Storage | Scope | Access |
|------|---------|-------|--------|
| **Shared** | team-knowledge repo | Team-wide | `gh api` + `rg` |
| **Local** | Auto-memory + learnings | Per-developer | File system |

**Shared knowledge** is for things the whole team benefits from knowing — architecture decisions, cross-cutting gotchas, resolved incidents, team conventions.

**Local knowledge** is for personal workflow preferences, individual learnings, and session context.

---

## Shared Knowledge (team-knowledge repo)

### Setup

The shared corpus lives at `darkroomengineering/team-knowledge`. One markdown file per note, plus a generated `INDEX.md`.

**For `/share-learning` (write path):** no local clone needed — the skill writes via `gh api`. Set the repo slug in your environment if you want to override the default:
```
KNOWLEDGE_REPO=darkroomengineering/team-knowledge
```

**For dev CLIs (`bun run lint:knowledge`, `bun run new-note`):** these tools operate on a local clone. Point them at it:
```
KNOWLEDGE_REPO_PATH=/path/to/your/clone/of/team-knowledge
```

Clone once with:
```bash
git clone https://github.com/darkroomengineering/team-knowledge ~/team-knowledge
```

### Note frontmatter contract

```
---
name: <kebab-case slug; equals filename without .md>
kind: decision | convention | gotcha | incident | pattern
tags: [kebab, strings]        # optional
added-by: <github login or name>
supersedes: <name>            # optional
---
<body: what + why + how to apply>
```

### What Goes in Shared Knowledge

| Kind | Example |
|------|---------|
| `decision` | "Chose Lenis over native smooth-scroll for cross-browser consistency" |
| `convention` | "All API routes return `{ data, error }` shape" |
| `gotcha` | "Sanity API returns UTC dates — always convert to local before display" |
| `incident` | "Hydration mismatch from useAuth — fixed with dynamic import, ssr:false" |
| `pattern` | "Wrap async server components in Suspense with skeleton fallback" |

### Agent Usage

**Reading shared knowledge (agents on dev machines):**
```bash
# Browse the index
cat $KNOWLEDGE_REPO_PATH/INDEX.md

# Search across all notes
rg "biome" $KNOWLEDGE_REPO_PATH/

# Read a specific note
cat $KNOWLEDGE_REPO_PATH/biome-mdx-ignored.md
```

**Adding shared knowledge:**
```bash
# Via the share-learning skill (preferred — handles dedup + gh api write)
/share-learning gotcha "Biome ignores .mdx files by default"
```

### Consumers

Two kinds of agents read this corpus:

- **Dev-machine agents** (Claude Code) — read via `cat INDEX.md` + `rg` across a local clone of the repo and post via `/share-learning`, which fetches INDEX.md for dedup before writing via `gh api`.
- **darky** (the studio Slack bot, now in `darkroomengineering/darkroom-os` under `darky-hermes/`; standalone `darky` repo frozen 2026-06-01) — reads team-knowledge **on-demand** via the GitHub REST contents API, gated to questions that touch a team convention/decision/gotcha.

### Best Practices

- Keep notes atomic — one learning per file
- Include the **why**, not just the **what**
- Add tags for discoverability
- Review periodically — remove outdated notes
- If a gotcha gets fixed upstream, supersede the note with a new one

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
/share-learning decision "Lenis over native smooth-scroll for cross-browser consistency"

# Team convention
/share-learning convention "All API routes return { data, error } — never throw to the caller"

# Cross-cutting gotcha
/share-learning gotcha "Sanity API returns UTC dates — always convert to local before display"
```
