---
name: share-learning
description: Promote a team-relevant learning to the shared team-knowledge repo, deduping against existing notes first. Triggers "share this", "promote to the team repo", "add to the knowledge base", or after a gotcha/decision/convention worth team-wide awareness.
allowed-tools:
  - Bash(gh api*)
  - Bash(base64*)
---

# share-learning

Promote a single learning to the team's shared knowledge repo (`darkroomengineering/team-knowledge`) —
the "public corpus" tier of the knowledge system (see `docs/knowledge-system.md`). Local,
personal knowledge stays in auto-memory; this skill is only for things another teammate's
agent would benefit from knowing.

## When to use

Use when a learning meets the shared-tier bar from `AGENTS.md` (Knowledge Routing): an
architecture decision the team must follow, a library gotcha that affects everyone, a
convention, an incident postmortem, or a reusable pattern. If it is a personal preference,
local project state, or an external pointer, let auto-memory handle it instead — do NOT
post it.

## Inputs

Invoked as `/share-learning <kind> "<text>"` where `<kind>` is one of:
`decision`, `convention`, `gotcha`, `incident`, `pattern`.

If invoked without arguments, infer the most likely `kind` and a concise `text` from the
recent conversation, then show the user what you intend to post and confirm before posting.

## Steps

1. **Resolve the repo.** Read `$KNOWLEDGE_REPO` from the environment; default is
   `darkroomengineering/team-knowledge`. If `$KNOWLEDGE_REPO` is unset and you do not want
   to use the default, stop and tell the user to set it (see `docs/knowledge-system.md` for
   setup).

2. **Dedup against the index (required).** Fetch the current index:

   ```bash
   gh api repos/$KNOWLEDGE_REPO/contents/INDEX.md --jq .content | base64 -d
   ```

   Scan the note names and titles in the index for an entry that already captures this
   learning (semantic near-duplicate, not just exact match). If you find one:
   - Show the user the existing note name and its summary line.
   - Ask whether to **skip** (already covered), **post anyway** (genuinely distinct), or
     **revise** your proposed entry to complement it.

   Only continue to step 3 once the user has chosen, or when there is clearly no duplicate.

3. **Post.** Derive a `name` (kebab-case slug from the essence of the learning). Assemble
   the note:

   - Frontmatter: `name` = the slug; `kind` from the argument; `added-by` from
     `gh api user --jq .login` (fall back to `git config user.name` if that fails);
     `tags` optional; `supersedes` only when this note replaces an existing one.
   - Body: what happened + why it matters + how to apply it. One learning per note,
     atomic and self-contained.

   If creating a new note:
   ```bash
   NOTE="---
   name: <name>
   kind: <kind>
   tags: [<tag1>, <tag2>]
   added-by: <login>
   ---

   <body>"

   gh api -X PUT repos/$KNOWLEDGE_REPO/contents/<name>.md \
     -f message="knowledge: add <name>" \
     -f content="$(printf '%s' "$NOTE" | base64)"
   ```

   If updating an existing note, first GET its current `sha`:
   ```bash
   SHA=$(gh api repos/$KNOWLEDGE_REPO/contents/<name>.md --jq .sha)
   gh api -X PUT repos/$KNOWLEDGE_REPO/contents/<name>.md \
     -f message="knowledge: update <name>" \
     -f content="$(printf '%s' "$NOTE" | base64)" \
     -f sha="$SHA"
   ```

4. **Report.** Surface the blob URL to the user:
   `https://github.com/$KNOWLEDGE_REPO/blob/main/<name>.md`

## Notes

- This skill posts to a shared, team-visible repo — treat it like publishing. Never post
  secrets, credentials, or anything from `.env`. When unsure whether something is
  team-relevant, ask the user rather than over-sharing.
- The dedup step is what makes this more than a `gh` wrapper: you are exercising judgment
  about whether the corpus already knows this.
