---
name: share-learning
description: Promote a team-relevant learning to the shared team-knowledge repo after deduping against existing notes. Triggers "share this", "add to the knowledge base", or a gotcha, decision, or convention worth team-wide awareness.
allowed-tools:
  - Bash(gh api*)
  - Bash(gh auth status*)
  - Bash(base64*)
  - Bash(mktemp -d /tmp/team-knowledge.*)
  - Bash(gh repo clone*)
  - Bash(bun /tmp/team-knowledge.*)
requires:
  - command: gh
    install: "Install GitHub CLI, run `gh auth login`, and request access to the team-knowledge repository."
---

# share-learning

Promote a single learning to the team's shared knowledge repo (`darkroomengineering/team-knowledge`),
the "public corpus" tier of `docs/knowledge-system.md`. Use it when `AGENTS.md` "Knowledge Routing"
sends the learning to the team repo; personal preferences, local project state, and external
pointers go to auto-memory instead. Do NOT post those.

## Write gate

Run this first, before any network call. Ask: if this note disappeared, would an engineer
reading the final code, tests, and comments still repeat the mistake or redo the
investigation? If not, write nothing and tell the user why in one line. An explicit request
asks for the judgment now; it does not lower the bar. Effort spent and diff size do not
qualify a learning. An existing note that is inaccurate qualifies for an update, not a
duplicate.

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
     `tags`, `scope`, `verified` and `retire_when` optional (see below); `supersedes`
     only when this note replaces an existing one.
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
   - `retire_when`: for a workaround or a note about a bug in someone else's tool,
     the outside change that makes it obsolete, in double quotes (`"Next.js 17
     ships the fix"`). A met condition is contradicting evidence regardless of age.
   - Body: open with the rule in one or two sentences, then what happened or why
     it matters, then how to apply it. An agent that reads only the first
     paragraph should know what to do. One learning per note, atomic and
     self-contained.

   Assign the note with a quoted heredoc, so the summary's double quotes and any
   backticks or `$` in the body stay literal.

   The repo's `main` only takes changes through a pull request, so write the note to a
   new branch and open a PR. A `PUT` straight to `main` fails with "Changes must be made
   through a pull request".

   ```bash
   BRANCH="knowledge/<name>"
   BASE=$(gh api repos/$KNOWLEDGE_REPO/git/ref/heads/main --jq .object.sha)
   gh api -X POST repos/$KNOWLEDGE_REPO/git/refs -f ref="refs/heads/$BRANCH" -f sha="$BASE"
   ```

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
   retire_when: "<condition>"  # only for workarounds with an outside exit
   added-by: <login>
   ---

   <body>
   EOF
   )

   gh api -X PUT repos/$KNOWLEDGE_REPO/contents/<name>.md \
     -f branch="$BRANCH" \
     -f message="knowledge: add <name>" \
     -f content="$(printf '%s' "$NOTE" | base64)"
   ```

   If updating an existing note, first GET its current `sha`:
   ```bash
   SHA=$(gh api repos/$KNOWLEDGE_REPO/contents/<name>.md --jq .sha)
   gh api -X PUT repos/$KNOWLEDGE_REPO/contents/<name>.md \
     -f branch="$BRANCH" \
     -f message="knowledge: update <name>" \
     -f content="$(printf '%s' "$NOTE" | base64)" \
     -f sha="$SHA"
   ```

   Regenerate `INDEX.md` on the branch. Its `lint` check fails when `INDEX.md` doesn't
   match the notes, and nothing regenerates it after the merge:
   ```bash
   TMP=$(mktemp -d /tmp/team-knowledge.XXXXXX)
   gh repo clone $KNOWLEDGE_REPO "$TMP" -- --depth 1 --branch "$BRANCH" -q
   bun "$TMP/scripts/build-index.ts"
   bun "$TMP/scripts/lint.ts"
   SHA=$(gh api "repos/$KNOWLEDGE_REPO/contents/INDEX.md?ref=$BRANCH" --jq .sha)
   gh api -X PUT repos/$KNOWLEDGE_REPO/contents/INDEX.md \
     -f branch="$BRANCH" \
     -f message="chore: regenerate INDEX.md" \
     -f content="$(base64 < "$TMP/INDEX.md")" \
     -f sha="$SHA"
   ```

   Then open the PR. Its `lint` check validates every note's frontmatter, including
   the 160-character `summary` limit; fix a failure on the same branch and regenerate
   `INDEX.md` again.
   ```bash
   gh pr create -R $KNOWLEDGE_REPO --base main --head "$BRANCH" \
     --title "knowledge: add <name>" --body "<the summary line>"
   ```

4. **Report.** Surface the PR URL to the user. Merging needs an approving review; agents
   see the note once the PR, with its regenerated `INDEX.md`, merges. Its final location is
   `https://github.com/$KNOWLEDGE_REPO/blob/main/<name>.md`.

## Refresh

When asked to refresh or audit existing notes, read each note, check its claims against
the current code, and assign exactly one outcome:

| Outcome | Meaning |
|---------|---------|
| Keep | Still accurate and useful. No edit. |
| Update | The rule holds; names, paths, links, or `verified` drifted. Fix in place. |
| Consolidate | Two correct notes overlap. Merge the unique content into one and delete the other. |
| Replace | The guidance misleads and a trustworthy successor can be written. Write it with `supersedes`. |
| Delete | The problem domain is gone and no other note substantively cites it. |

- Unverifiable is not false: act on a contradiction in the code, never on the absence of
  a confirming artifact.
- Age alone is not staleness. A met `retire_when`, or code that contradicts a claim, is
  grounds for Update, Replace, or Delete. When the code still carries the workaround, keep
  the note and recommend removing the workaround.
- Missing files prove the implementation is gone, not the problem. If the problem domain is
  still active, that is Replace.
- Before a Delete, search the corpus for the note's name; a note that another note relies on
  is Replace or Keep.
- Do not edit for typos or wording. Changes land as one team-knowledge PR, like any other
  note change.

## Notes

This skill publishes to a shared, team-visible repo, so apply `AGENTS.md` "Safety" strictly. When unsure
whether something is team-relevant, ask the user rather than over-sharing.
