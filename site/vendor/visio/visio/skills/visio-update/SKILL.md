---
name: visio-update
description: Update a project to a new visio release - check vendor/visio/ for edits, run `bun run visio:update`, act on every Breaking entry of the notes it prints, and verify the project. Use when asked to update or upgrade visio, install a release, or when `visio:check` fails with VENDOR_EDITED. Also covers the first install into a project.
---

# Update visio

A project gets the packages as files in `vendor/visio/`, from a GitHub release of `darkroomengineering/visio`. An update replaces that folder, relinks the skills, and prints the notes of every release it skipped. Each Breaking entry is a step for the project. Design: `visio/DESIGN.md`, Releases (`vendor/visio/visio/DESIGN.md` in a project).

## Steps

1. **Start from a clean tree.** `git status` shows no change. Then the diff after the update is the update and your steps, nothing else.
2. **Check the login.** `gh auth status` shows an account that can read `darkroomengineering/visio`. The download uses it.
3. **Check for edits.** Run `bun run visio:check`. On `[VENDOR_EDITED]`, stop and tell the user which files changed. Someone made those edits: never drop them with `git checkout -- vendor/visio` unless the user says so. A fix that a project needs goes into the visio repo, then into a release.
4. **Update.** Run `bun run visio:update` for the latest release, or `bun run visio:update v2026.10.08-1432` for one release. It ends with `[visio] vendor/visio is release <tag> (<commit>), was <old tag>.`
5. **Keep the notes.** The update prints them once, before `bun install`: `[visio] The notes of <tags>. Act on Breaking, then read the rest:`. They are merged by heading, so Breaking comes first. When `bun install` then fails, a Breaking entry can name the cause (a package the release removed): do its steps and run `bun install` again. To read them again, run `gh release view <tag> -R darkroomengineering/visio` for each tag in that line.
6. **Act on Breaking.** Do every entry, one at a time. An entry names the error text or the identifier (`HOVER_NEEDS_CONDITION`, `visio/preload-returns`, `syncProject()`). Search the project for it, make the change that the entry gives, and run the check that reports it. To see why a change was made, run `gh pr view <n> -R darkroomengineering/visio` with the PR number at the end of the entry. Before you change code under a package, read that package's skill again: the update can change the skill too.
7. **Leave Optional to the user.** List each Optional entry with a line on what it gives. Do one only when the user asks. Features and Fixes need no step.
8. **Verify.** Run `bun run visio:check`, then the project's typecheck, lint and build scripts (`package.json`). Each must pass. A failure that a Breaking entry names is a step you missed. Any other failure: report it with the output, and do not work around it in `vendor/visio/`.
9. **Commit.** One commit holds `vendor/visio/`, `package.json`, `bun.lock`, the links in `.claude/skills/`, and the Breaking steps: `chore: update visio to <tag>`. In the body, list the Breaking steps you did and the Optional entries you left.

## First install

A project without `vendor/visio/` has no `visio:update` script yet. Run this from the project root:

```sh
gh release download -R darkroomengineering/visio -p visio.tar.gz -O - | tar -xz
bun vendor/visio/visio/bin/visio-vendor.ts update
```

The update writes the workspace, the `visio:update` and `visio:check` scripts, the catalog and the Solid pins into the root `package.json`, then installs. Then add `vendor/visio` to `ignorePatterns` in `oxfmt.config.ts` and `oxlint.config.ts`, else the formatter edits the files and `visio:check` fails. Add `bun run visio:check` to the project's CI.

## When something is wrong

| Symptom | Cause |
| --- | --- |
| `gh release download` failed | The `gh` account cannot read the repo, or is not logged in. |
| `<tag> is not a release tag` | The tag is not of the form `v2026.10.08-1432`. |
| `[VENDOR_EDITED]` and `The update stopped, so the edits are not lost.` | `vendor/visio/` has edits. See step 3. |
| `Two packages have a skill named <name>` | The release has two skills of one name. Report it to the visio repo. |
| `skills: skipped .claude/skills/<name>: it is the project's own skill` | The project has a skill of its own with that name, so it does not get the release's. Tell the user; remove it only when they say so. |
| A Breaking entry's error after the steps | A place the search missed. Search again for the identifier in all of `src/`, `studio/` and the config files. |
