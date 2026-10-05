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

**For `/share-learning` (write path):** install the [GitHub CLI](https://cli.github.com/), run
`gh auth login`, and make sure the authenticated account can read the knowledge repository:

```bash
gh auth status
gh api repos/darkroomengineering/team-knowledge --jq .full_name
```

No local clone is needed. After you confirm the proposed note, the skill writes it to a
`knowledge/<name>` branch with `gh api` and opens a pull request, because the repo's `main`
accepts changes only through a PR. The note reaches other agents once the PR is merged. Set the repo slug in your environment if you want to override the default:
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
summary: "<one line, max 160 chars, no ·>"
tags: [kebab, strings]        # optional
scope: [repo-name]            # optional
verified: "YYYY-MM-DD"        # optional
added-by: <github login or name>
supersedes: <name>            # optional
---
<body: the rule first, then why, then how to apply>
```

`summary` is required. It becomes the note's `<hook text>` in `INDEX.md`,
which is all the `knowledge-hint` hook shows an agent before it decides to
open the note, so it states the rule and what to do, not how it was found.

`tags` are matched as whole words against the command or file an agent is
working on, so literal identifiers (`drizzle-kit`, `getboundingclientrect`)
make the hint fire at the right moment. `scope` lists the GitHub repo names a
note applies to; the hook hides a scoped note in any other repo. `verified`
dates a note's version-specific claims; the linter warns once it is older than
180 days.

### INDEX.md line format contract

Every note gets one line in the generated `INDEX.md`, consumed by the
knowledge-index cache and the `knowledge-hint` hook (see "Agent Usage"
below):
```
- [<kind>: <name>](<name>.md) — <hook text> · scope: x, y · tags: a, b, c
```
Each ` · <field>: ...` suffix (`·` = U+00B7) is omitted when the note has no
value for it. Scope comes before tags, so a parser that splits only the last
`·` still finds the tags. `—` is U+2014. A change to this line shape needs a matching change to
`parseIndexMarkdown` in `src/lib/knowledge-index.ts`.

### What Goes in Shared Knowledge

| Kind | Example |
|------|---------|
| `decision` | "Chose Lenis over native smooth-scroll for cross-browser consistency" |
| `convention` | "All API routes return `{ data, error }` shape" |
| `gotcha` | "Sanity API returns UTC dates — always convert to local before display" |
| `incident` | "Hydration mismatch from useAuth — fixed with dynamic import, ssr:false" |
| `pattern` | "Wrap async server components in Suspense with skeleton fallback" |

### Agent Usage

**The read path, end to end:**

1. **SessionStart banner.** `teamKnowledgeAwareness()` prints a one-line count
   ("N shared notes") from the TTL-cached index, plus the read command below —
   awareness only, no note content.
2. **`knowledge-hint` hook.** A PreToolUse hook on `Bash|Edit|Write` scores
   the cached notes' slug words + tags against the command/file being acted
   on and surfaces up to 3 matching notes (title + one-line hook text) via
   `additionalContext`, once per note per session. A note with a `scope` is
   shown only when the session's repo (its origin remote name or checkout
   folder) is in that scope. It never hits the network
   — it only reads the same TTL cache the SessionStart banner does.
3. **Read a note the hint pointed at:**
```bash
gh api repos/darkroomengineering/team-knowledge/contents/<name>.md --jq .content | base64 -d
```

**Alternative: local clone.** If you've cloned the corpus and set
`$KNOWLEDGE_REPO_PATH` (see Setup above), you can browse and search it
directly instead of going through `gh api`:
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
# Via the share-learning skill (preferred — handles dedup, then opens a PR)
/share-learning gotcha "Biome ignores .mdx files by default"
```

### Consumers

Two kinds of agents read this corpus:

- **Dev-machine agents** (Claude Code) — read via the SessionStart banner and the `knowledge-hint` PreToolUse hook (both driven by the TTL-cached index, itself parsed from `INDEX.md`), fetch a flagged note with `gh api ... --jq .content | base64 -d`, or — when `$KNOWLEDGE_REPO_PATH` is set — browse a local clone with `cat`/`rg` directly. They post via `/share-learning`, which fetches `INDEX.md` for dedup before writing via `gh api`.
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
