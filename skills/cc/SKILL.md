---
name: cc
description: Sync cc-settings with upstream Claude Code (maintainer) or pull the latest cc-settings (user). Triggers "sync with claude code", "changelog sync", "upstream sync" (sync mode); "update cc-settings", "refresh my install" (update mode).
---

# cc — Claude Code settings management

Two-mode skill: **sync** keeps the cc-settings repo current with Claude Code upstream (maintainer task); **update** pulls the latest cc-settings into your local install (everyone).

## Mode: sync

Audit cc-settings against Claude Code changelog; identify features to adopt and duplication to remove; stops for approval.

Track the official Claude Code changelog and keep cc-settings (schemas, config,
hooks, agents, docs) in sync with new features. Removes anything that
duplicates native functionality.

This is run on a weekly cadence. The mechanical parts are scripted; the
judgment calls (which features to adopt, what counts as duplication) require
human review at the gate.

### Before you start

Always run from the `cc-settings` repo root. If you're not there, ask the user
where it is — don't guess.

```bash
pwd  # should end in /cc-settings
git status  # tree must be clean before starting
```

If the tree is dirty, ask the user to commit or stash first. Sync work needs a
clean baseline so the diff is reviewable.

### Phase 1 — Detect drift

```bash
bun run upstream:scan
```

This compares `upstream/claude-code-manifest.json` against the live
`@anthropic-ai/claude-code` npm version. Two outcomes:

- **No drift** — manifest matches live. Stop here. There's nothing to sync.
  Tell the user "already in sync at v<X>" and end.
- **Drift detected** — capture both versions. Format: `manifest=A → live=B`.

### Phase 2 — Fetch the upstream changelog

Fetch the official changelog and extract entries between the manifest version
(exclusive) and the live version (inclusive):

```
WebFetch url: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md
prompt: Extract entries for versions <A+1> through <B> verbatim. List each
        version's bullet points exactly as written.
```

Do not paraphrase. Quote the upstream bullets verbatim — the user needs to see
exactly what was said upstream to validate your categorization.

### Phase 3 — Cross-reference cc-settings

For each upstream change, decide which bucket it falls into. Read these files
to inform the decision (use parallel tool calls):

| Bucket | What to check |
|---|---|
| Settings keys | `src/schemas/settings.ts` (zod schema, strict — drift fails parse) |
| Hook events / types | `src/schemas/hooks.ts` (5-arm discriminated union as of v10.3.0) |
| MCP fields | `src/schemas/mcp.ts` (shared `mcpCommon` for cross-transport fields) |
| Env vars | `upstream/claude-code-manifest.json` `knownEnvVars`, `docs/settings-reference.md` env table, `config/10-core.json` `env` block |
| Hook wiring | `config/40-hooks.json`, `src/hooks/`, `src/scripts/` |
| Statusline | `src/hooks/statusline.ts` (Payload type) |
| Agent frontmatter | `agents/*.md` (currently uses `tools`, `disallowedTools`, `maxTurns`, `permissionMode`, `effort`, `isolation`, `hooks`, `mcpServers`, `initialPrompt`) |
| Slash commands | `MANUAL.md` "All Skills" table, `skills/*/SKILL.md` triggers |
| User-facing docs | `MANUAL.md`, `CLAUDE-FULL.md`, `docs/settings-reference.md`, `docs/hooks-reference.md` |

Bucket each change as one of:

- **ADOPT** — new upstream feature worth taking. List the exact files to edit.
- **DEDUPE** — native feature that now overlaps with cc-settings code. List the
  files/lines to delete. Look hardest for these — they're the cleanup wins.
- **DOCS-ONLY** — purely a documentation update (e.g. slash command renamed,
  table needs refresh).
- **SKIP** — not relevant (Windows-only, enterprise-only, fixes a bug we
  didn't have, etc.). Briefly say why.

#### Common DEDUPE patterns to look for

cc-settings has historically duplicated upstream work, then deleted it once
the upstream version stabilized. Watch for these patterns:

- A new built-in hook event subsumes a custom hook script.
- A new tool replaces a wrapper we maintain (e.g. native `Skill` tool
  replaced our `skill-activation.ts` in v10.1.0).
- A new frontmatter field replaces a script-driven workaround.
- A new env var replaces a custom env-var dance.

### Phase 4 — Stop. Present the plan.

Write a markdown table to the chat:

```
## v<A> → v<B> sync plan

### Adopt
| Change | Files | Notes |
|---|---|---|
| ... | ... | ... |

### Dedupe
| Native feature | What to remove | Why redundant |
|---|---|---|

### Docs-only
| Change | File |
|---|---|

### Skip
| Change | Reason |
|---|---|
```

Then ask the user **one** question: which rows do they approve?
- "Approve all" → continue with everything.
- "Approve subset" → user names rows.
- "Reject" → end the skill, no edits.

Do not edit before approval.

### Phase 5 — Execute approved changes

For approved adoptions, edit the files directly. Schemas first (they're the
contract), then config, then docs. For deduptions, delete the orphaned code
and any tests that asserted on it.

After each schema edit, also update `upstream/claude-code-manifest.json`
(`knownSettingsKeys`, `knownHookTypes`, `knownEnvVars`) — the scanner uses
this as the source of truth.

### Phase 6 — Manifest bump + version bump + CHANGELOG

```
upstream/claude-code-manifest.json
  - claudeCodeVersion: "<B>"
  - lastScan: <today ISO>
src/setup.ts
  - VERSION: bump (minor for new features, patch for fixes-only)
CHANGELOG.md
  - Prepend new section: "## [<new-version>] — <today YYYY-MM-DD>"
```

CHANGELOG entry structure (mirror prior entries — 10.1.0, 10.2.0, 10.2.1, 10.3.0
are good examples):

1. One-line summary.
2. **Adopted:** bullet per feature. State the upstream version, the file(s)
   touched, and a one-sentence "why this matters".
3. **Deletions / Native-now-redundant:** bullet per removed thing. State
   what replaced it and the upstream version.
4. **Files changed:** flat list, one per line.

### Phase 7 — Validate

```bash
bun run typecheck
bun test
bun run upstream:scan   # should now show "no drift detected"
bun run compose | head  # spot-check that new fields surface in settings.json
```

If any fail: fix before moving on. Tests must pass.

### Phase 8 — Commit + push

```bash
git add -A
git commit -m "feat(v<new-version>): sync with Claude Code v<B>

<one-paragraph summary>

Adopted:
- ...

Deletions:
- ..."
git push origin main
```

Use conventional commit prefix `feat(v<X.Y.Z>):` so the version stands out in
git log. Do not push if anything in Phase 7 is failing.

### What this mode does NOT do

- It does not edit user-installed `~/.claude/settings.json`. cc-settings is the
  source — users get the changes by re-running `setup.sh`.
- It does not auto-open PRs. The upstream-sync GitHub Action handles
  manifest-only bumps; this skill is for the richer human-reviewed sync.
- It does not bump dependencies. That's a separate concern.

### Mental model

cc-settings exists in three time zones:

1. **Upstream** — what Claude Code does today. Source: changelog + docs.
2. **Manifest** — what cc-settings believes upstream does. Source:
   `upstream/claude-code-manifest.json`.
3. **Implementation** — what cc-settings actually wires up. Source: schemas,
   config, hooks, agents.

Drift between (1) and (2) means the scanner is stale.
Drift between (2) and (3) means our schemas accept things our installer never
configures, or vice versa — usually fine, but worth flagging.

This mode aligns all three.

---

## Mode: update

Pull the latest cc-settings into your local `~/.claude/` install.

### Phase 1 — Locate the working repo

The cc-settings working tree is usually at `~/.claude/cc-settings/`. Some users (notably the original maintainers) keep it elsewhere — e.g. `~/Developer/...`. Find it:

```bash
# Try the documented default first
[ -d "$HOME/.claude/cc-settings/.git" ] && CC_REPO="$HOME/.claude/cc-settings"

# If not there, the version sentinel doesn't record the path — ask the user
[ -z "$CC_REPO" ] && echo "Where is your cc-settings working tree? (path)"
```

Verify the path is a clone of `darkroomengineering/cc-settings`:

```bash
git -C "$CC_REPO" remote -v | grep -q 'darkroomengineering/cc-settings' || {
  echo "Not a cc-settings clone"; exit 1;
}
```

### Phase 2 — Detect drift

```bash
# Installed version
INSTALLED=$(jq -r .version "$HOME/.claude/.cc-settings-version" 2>/dev/null)

# Latest version on remote main (read from src/setup.ts in origin/main)
git -C "$CC_REPO" fetch --quiet origin main
LATEST=$(git -C "$CC_REPO" show origin/main:src/setup.ts | grep -E '^const VERSION' | sed -E 's/.*"([0-9.]+)".*/\1/')

echo "Installed: $INSTALLED"
echo "Latest:    $LATEST"
```

If equal: report "already up to date" and stop. If installed > latest: surface the discrepancy (manual edit?) and ask.

### Phase 3 — Render what changed

Show commits and the relevant CHANGELOG entries:

```bash
# Commits between the installed version and origin/main
# (find the tag/commit that bumped to $INSTALLED, then log from there)
git -C "$CC_REPO" log --oneline "HEAD..origin/main" | head -20

# CHANGELOG entries above the installed version
awk -v v="$INSTALLED" '
  /^## \[/ { found = ($0 ~ "\\[" v "\\]") ? 1 : 0; if (found) exit }
  !found { print }
' "$CC_REPO/CHANGELOG.md"
```

Display this block to the user. **Stop. Wait for confirmation** before applying. Don't auto-pull — give them the chance to read and bail.

### Phase 4 — Pre-flight: working-tree safety

```bash
# Hard-stop if the user has uncommitted edits on their cc-settings checkout —
# `git pull` will either merge or fail, both worse than asking.
if ! git -C "$CC_REPO" diff --quiet || ! git -C "$CC_REPO" diff --cached --quiet; then
  echo "Local uncommitted changes in $CC_REPO:"
  git -C "$CC_REPO" status --short
  echo "Stash, commit, or discard before updating. Aborting."
  exit 1
fi

# Hard-stop if they're not on main — they probably forked / are working on a feature
BRANCH=$(git -C "$CC_REPO" branch --show-current)
[ "$BRANCH" != "main" ] && {
  echo "On branch '$BRANCH', not main. Switch first or update manually."
  exit 1
}
```

### Phase 5 — Apply

```bash
git -C "$CC_REPO" pull --ff-only origin main
bash "$CC_REPO/setup.sh"
```

If the user has hand-edits to `~/.claude/settings.json` (custom permissions, hooks, env), the installer preserves them automatically. Pass `--interactive` if they want to review each merge:

```bash
bash "$CC_REPO/setup.sh" --interactive
```

### Phase 6 — Verify and nudge

```bash
NEW=$(jq -r .version "$HOME/.claude/.cc-settings-version")
[ "$NEW" = "$LATEST" ] && echo "Updated to $LATEST" || echo "Sentinel still reports $NEW (expected $LATEST)"
```

Then tell the user:

> **Restart Claude Code** to pick up the new agents/skills/hooks. New skills only auto-invoke after restart.

If the update introduced new MCP servers or env vars, mention those by name (read from the rendered CHANGELOG section in Phase 3).

### What this mode does NOT do

- It does not modify the `cc-settings` repo. Maintainer-facing sync work goes through sync mode.
- It does not rollback. If the new version misbehaves, run `bun "$CC_REPO/src/setup.ts" --rollback` to restore the most recent backup in `~/.claude/backups/`.
- It does not pin to a specific version. To install an older release, `git -C "$CC_REPO" checkout <tag>` first, then run `bash setup.sh` directly.
