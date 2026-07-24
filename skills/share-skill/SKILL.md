---
name: share-skill
description: Promote a session-created skill into the darkroom-team-skills plugin marketplace, deduping against cc-settings core and existing marketplace plugins first. Triggers "share this skill", "promote to team-skills", "add this skill to the marketplace", or after building a skill worth reusing studio-wide.
context: main
allowed-tools:
  - Bash(bun src/scripts/lint-skills.ts*)
  - Bash(git*)
  - Bash(gh pr create*)
  - Read
  - Write
  - Glob
  - Grep
---

# share-skill

Promote a single skill into the studio's plugin marketplace repo (marketplace
name `darkroom-team-skills`) — the private tier of the marketplace (see its
README for the two-tier model). The sibling of `/share-learning`: that skill
shares prose knowledge, this one shares an executable skill, so the bar and the
checks are higher.

## When to use

Use when a skill built or refined in this session would benefit other studio
engineers on their own projects — a reusable workflow, a stack-specific helper, a
hardened prompt for a recurring task. If it is a personal convenience, a one-off
for the current repo, or overlaps a skill the studio already has, do NOT promote
it; auto-memory or the project repo is the right home.

## Inputs

Invoked as `/share-skill [skill-dir]`. If the argument is omitted, infer the most
recently created or edited skill directory (a folder containing `SKILL.md`) from
this session's work, show the user which one you picked, and confirm before
proceeding.

## Steps

1. **Resolve the marketplace.** The marketplace is a local clone, so the path is
   per-machine — never hardcode one. Resolve it in one command, which both
   expands `$TEAM_SKILLS_REPO_PATH` (falling back to `~/team-skills`) and proves
   the directory is a real git repo:

   ```bash
   git -C "${TEAM_SKILLS_REPO_PATH:-$HOME/team-skills}" rev-parse --show-toplevel
   ```

   Then confirm the clone is the right one: it must contain
   `.claude-plugin/marketplace.json` whose `name` is `darkroom-team-skills`. A
   different marketplace sitting at the default path is a wrong-repo hazard — do
   not proceed on path existence alone.

   If either check fails, STOP and tell the user to clone the marketplace and
   point the variable at it:

   ```bash
   export TEAM_SKILLS_REPO_PATH=/path/to/your/clone/of/team-skills
   ```

   Never write into a guessed path. Every `[marketplace]` below means this
   resolved, verified directory.

2. **Identify.** Resolve the candidate directory; it must contain a `SKILL.md`.

3. **Validate (required).** Run the cc-settings skill linter against the
   candidate's PARENT directory:

   ```bash
   bun src/scripts/lint-skills.ts [parent-dir-of-candidate]
   ```

   Tell the user that custom-dir runs skip the ACTIVE_SKILLS registry check (the
   skill is not going into cc-settings core), but every content rule still
   applies: kebab-case folder matching frontmatter name, no README.md inside the
   skill dir, no angle brackets in frontmatter, description 50-1024 chars with
   trigger language. Block on any error; surface warnings and let the user decide.

4. **Dedup (required).** Two passes, presented as one findings list:
   - Read the `description` frontmatter of every `~/.claude/skills/*/SKILL.md`
     (cc-settings core as installed).
   - Read the `description` frontmatter of every
     `[marketplace]/plugins/*/skills/*/SKILL.md` (skills already in the
     marketplace).

   Compare trigger phrases and semantic overlap against the candidate. For any
   overlap, show the existing skill and its triggers, then ask the user to choose:
   **skip** (already covered — abort), **rename** (differentiate name +
   description, then re-run step 3), or **proceed** (genuinely distinct). Only
   continue once the user has chosen or there is clearly no overlap.

5. **Choose the target plugin.** List the existing `[marketplace]/plugins/*`
   directories and let the user pick one, or name a new plugin. For an existing
   plugin no manifest edit is needed (skills are discovered by convention at
   `plugins/[plugin]/skills/[name]/SKILL.md`). For a new plugin, create
   `plugins/[plugin]/.claude-plugin/plugin.json` (name, description, version
   0.1.0, author Darkroom Engineering) and append a matching entry to
   `.claude-plugin/marketplace.json`'s `plugins` array.

6. **Copy.** Copy the FULL skill directory (not just SKILL.md — future skills may
   carry `references/`) into `[marketplace]/plugins/[plugin]/skills/[name]/`.

7. **Land.** Check `git -C [marketplace] remote`:
   - Remote exists: confirm it points at the studio's team-skills repo (not a
     fork or an unrelated clone), then create branch `add-skill/[name]`, commit
     `feat: add [name] skill to [plugin] plugin`, push, and open a PR with
     `gh pr create` (plain-English body per rules/git.md — what it does, why it
     is studio-relevant, how it was validated). Report the PR URL.
   - No remote (marketplace still local-only): commit directly to the current
     branch with the same message and report the commit SHA.

8. **Report.** Surface the resulting path
   `[marketplace]/plugins/[plugin]/skills/[name]/` and the PR URL if one was
   opened.

## Notes

- This copies files into a shared marketplace other engineers will install and
  run — treat it like publishing. Never share a skill dir containing secrets,
  `.env` values, credentials, or `references/` material with project-specific
  internals. When unsure whether a skill is studio-wide vs project-specific, ask
  the user rather than over-sharing.
- The dedup step is the point: two installed skills with overlapping trigger
  phrases make skill selection ambiguous for everyone. Reject overlaps hard;
  renaming is cheap, a noisy selector is not.
