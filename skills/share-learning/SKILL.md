---
name: share-learning
description: Promote a team-relevant learning to the shared GitHub Project knowledge board, deduping against existing items first. Triggers "share this", "promote to the team board", "add to the knowledge base", or after a gotcha/decision/convention worth team-wide awareness.
allowed-tools:
  - Bash(gh project item-list*)
  - Bash(gh project item-create*)
---

# share-learning

Promote a single learning to the team's shared GitHub Project knowledge board — the
"public corpus" tier of the knowledge system (see `docs/knowledge-system.md`). Local,
personal knowledge stays in auto-memory; this skill is only for things another teammate's
agent would benefit from knowing.

## When to use

Use when a learning meets the shared-tier bar from `AGENTS.md` (Knowledge Routing): an
architecture decision the team must follow, a library gotcha that affects everyone, a
convention, an incident postmortem, or a reusable pattern. If it is a personal preference,
local project state, or an external pointer, let auto-memory handle it instead — do NOT
post it.

## Inputs

Invoked as `/share-learning <type> "<text>"` where `<type>` is one of:
`decision`, `convention`, `gotcha`, `incident`, `pattern` (the board's **Type** field).

If invoked without arguments, infer the most likely `type` and a concise `text` from the
recent conversation, then show the user what you intend to post and confirm before posting.

## Steps

1. **Resolve the board.** Read `$KNOWLEDGE_PROJECT_NUMBER` from the environment; the owner
   is `darkroomengineering`. If `$KNOWLEDGE_PROJECT_NUMBER` is unset, stop and tell the user
   to set it (see `docs/knowledge-system.md` for setup) — do not guess a project number.

2. **Dedup against the board (required).** List existing items:

   ```bash
   gh project item-list "$KNOWLEDGE_PROJECT_NUMBER" --owner darkroomengineering --format json
   ```

   Scan the returned titles and bodies for an item that already captures this learning
   (semantic near-duplicate, not just exact match). If you find one:
   - Show the user the existing item.
   - Ask whether to **skip** (already covered), **post anyway** (genuinely distinct), or
     **revise** your proposed entry to complement it.

   Only continue to step 3 once the user has chosen, or when there is clearly no duplicate.

3. **Post.** Create the item:

   ```bash
   gh project item-create "$KNOWLEDGE_PROJECT_NUMBER" --owner darkroomengineering \
     --title "<type>: <concise title>" \
     --body "<the learning, atomic and self-contained — what + why + how to apply>"
   ```

   Keep entries atomic (one learning per item) and self-contained, per
   `docs/knowledge-system.md`.

4. **Report.** Surface the created item's URL to the user.

## Notes

- This skill posts to a shared, team-visible board — treat it like publishing. Never post
  secrets, credentials, or anything from `.env`. When unsure whether something is
  team-relevant, ask the user rather than over-sharing.
- The dedup step is what makes this more than a `gh` wrapper: you are exercising judgment
  about whether the corpus already knows this.
