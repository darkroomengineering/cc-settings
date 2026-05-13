---
name: share-learning
description: Post a team-wide learning to the GitHub Project knowledge base. For personal/local notes use the auto-memory system (see ~/.claude/CLAUDE.md). Triggers "share learning", "team knowledge", "post to knowledge base", "everyone should know".
---

# Share Learning — Team Knowledge Base

Post architectural decisions, cross-cutting gotchas, conventions, and incident
postmortems to the shared GitHub Project so other team members' AI agents pick
them up. **Local / per-developer notes belong in auto-memory** (see the "auto
memory" section in `~/.claude/CLAUDE.md`) — this skill is shared-only.

## When to use this vs auto-memory

| Situation | Where it belongs |
|---|---|
| Personal workflow preference ("I want terse responses") | auto-memory (`user` or `feedback`) |
| Active project state, deadlines, blockers | auto-memory (`project`) |
| Pointer to external system (Linear board, dashboard URL) | auto-memory (`reference`) |
| Architecture decision the team must follow | **share-learning** |
| Library gotcha that affects everyone | **share-learning** |
| Convention ("All API routes return `{ data, error }`") | **share-learning** |
| Incident postmortem worth team awareness | **share-learning** |

**Rule of thumb:** if another team member's AI agent would benefit from knowing
it, share. Otherwise let auto-memory handle it.

## Categories

`decision`, `convention`, `gotcha`, `incident`, `pattern`

## Storing

Posts directly to the team's GitHub Project board via `gh` CLI. Requires `gh`
authenticated and the project number configured in `CLAUDE.local.md` or the
shell env (`KNOWLEDGE_PROJECT_NUMBER`).

```bash
gh project item-create $KNOWLEDGE_PROJECT_NUMBER \
  --owner "<org>" \
  --title "<category>: <one-line summary>" \
  --body "<full learning, context, why>"
```

Examples:
```bash
# Architecture decision
gh project item-create "$KNOWLEDGE_PROJECT_NUMBER" --owner darkroomengineering \
  --title "decision: Lenis over native smooth-scroll" \
  --body "Chose Lenis for cross-browser consistency. Native smooth-scroll diverges on Safari and Firefox; Lenis normalizes inertia + delta math. See ADR-007."

# Team convention
gh project item-create "$KNOWLEDGE_PROJECT_NUMBER" --owner darkroomengineering \
  --title "convention: API response shape" \
  --body "All API routes return { data, error } shape — never throw to the caller. Enforced by Biome rule in services/api/."

# Cross-cutting gotcha
gh project item-create "$KNOWLEDGE_PROJECT_NUMBER" --owner darkroomengineering \
  --title "gotcha: Sanity UTC dates" \
  --body "Sanity API returns UTC dates — always convert to local before display. Affects all date renderers."
```

## Recalling

```bash
gh project item-list "$KNOWLEDGE_PROJECT_NUMBER" --owner "<org>" --format json
```

See `docs/knowledge-system.md` for the `gh api graphql` patterns agents use to
read entries on session start, including filter-by-category and search.

## Storage

GitHub Project board — requires `gh` CLI authenticated and a configured project
number in `CLAUDE.local.md` or the environment. Setup steps are in
`docs/knowledge-system.md`.

## Best Practices

1. **Be specific** — include the actual rule or fix, not "fixed the bug"
2. **Include why** — future readers (human and AI) need the rationale
3. **Categorize correctly** — helps with recall
4. **Archive when superseded** — outdated team knowledge is worse than none
