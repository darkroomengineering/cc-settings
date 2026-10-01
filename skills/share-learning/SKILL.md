---
name: share-learning
description: Promote a team-relevant learning to the shared team-knowledge repo after deduping against existing notes. Triggers "share this", "add to the knowledge base", or a gotcha, decision, or convention worth team-wide awareness.
allowed-tools:
  - Bash(gh api*)
  - Bash(gh auth status*)
  - Bash(base64*)
requires:
  - command: gh
    install: "Install GitHub CLI, run `gh auth login`, and request access to the team-knowledge repository."
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

Before starting, run `gh auth status` and confirm the authenticated account can read
`darkroomengineering/team-knowledge` (or `$KNOWLEDGE_REPO`) with
`gh api repos/${KNOWLEDGE_REPO:-darkroomengineering/team-knowledge} --jq .full_name`. Stop with the
failed prerequisite if either check fails. Do not wait until the write step to surface missing
authentication or repository access.

## Steps

1. **Resolve the repo.** Read `$KNOWLEDGE_REPO` from the environment; default is
   `darkroomengineering/team-knowledge`:

   ```bash
   KNOWLEDGE_REPO="${KNOWLEDGE_REPO:-darkroomengineering/team-knowledge}"
   ```

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

   - Frontmatter: `name` = the slug; `kind` from the argument; `summary` (required,
     see below); `added-by` from
     `gh api user --jq .login` (fall back to `git config user.name` if that fails);
     `tags`, `scope` and `verified` optional (see below); `supersedes` only when
     this note replaces an existing one.
   - `summary`: one line, at most 160 characters, no `·`, in double quotes. It
     becomes the note's line in `INDEX.md`, which is all an agent sees before
     deciding to open the note, so state the rule and what to do, not how it was
     found. Good: "drizzle-kit push on SQLite plans `delete from` for any new NOT
     NULL column, even with a default; add the column with ALTER TABLE." Bad:
     "What happened: on theca, drizzle-kit push against prod...". Never put `"` or
     `\` inside it: in YAML double quotes a backslash starts an escape sequence,
     so `\d+` fails to parse and `\b` silently turns into a control character.
     Rephrase instead (write "digits", not `\d+`).
   - `tags`: the `knowledge-hint` hook matches them as whole words against the
     command or file an agent is working on, and one specific tag is enough to
     surface the note. Include the literal identifiers that appear there,
     lowercased (`drizzle-kit`, `getboundingclientrect`, `x-fb-ck-fbp`); skip
     identifiers used everywhere (`useref`). A hyphenated tag matches only a
     hyphen, so tag `sendmsg`, not `scm-rights` for `SCM_RIGHTS`.
   - `scope`: repo names (as on GitHub) the note applies to, e.g. `[programa]`.
     The hook hides a scoped note in every other repo, so add it only when the
     rule is wrong or irrelevant elsewhere, never because the learning came from
     one repo. Check the name with `gh repo view darkroomengineering/<name>`.
   - `verified`: for a note about a tool, SDK or service version, the date
     (`"YYYY-MM-DD"`, quoted) its claims were last confirmed.
   - Body: open with the rule in one or two sentences, then what happened or why
     it matters, then how to apply it. An agent that reads only the first
     paragraph should know what to do. One learning per note, atomic and
     self-contained.

   Assign the note with a quoted heredoc, so the summary's double quotes and any
   backticks or `$` in the body stay literal.

   If creating a new note:
   ```bash
   NOTE=$(cat <<'EOF'
   ---
   name: <name>
   kind: <kind>
   summary: "<one-line rule, max 160 chars>"
   tags: [<tag1>, <tag2>]
   scope: [<repo>]             # only when the rule applies to one repo
   verified: "<YYYY-MM-DD>"    # only for version-specific claims
   added-by: <login>
   ---

   <body>
   EOF
   )

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
