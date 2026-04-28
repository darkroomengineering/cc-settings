---
name: cc-update
description: |
  Use when:
  - User says "update cc-settings", "upgrade cc-settings", "/cc-update"
  - User says "pull the latest cc-settings", "refresh my install"
  - User wants to apply newly-released cc-settings changes locally

  Updates the user's local cc-settings install (the things in `~/.claude/`)
  with the latest commits on `origin/main`. Shows what changed before
  applying, warns about local customizations in the working repo, runs
  the installer, and prints a restart nudge. Pairs with `/cc-sync` —
  use `/cc-sync` to sync the cc-settings repo with Claude Code upstream
  (maintainer-facing); use `/cc-update` to pull the latest cc-settings
  into your install (user-facing).
---

# cc-update — pull the latest cc-settings into your install

## Phase 1 — Locate the working repo

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

## Phase 2 — Detect drift

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

## Phase 3 — Render what changed

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

## Phase 4 — Pre-flight: working-tree safety

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

## Phase 5 — Apply

```bash
git -C "$CC_REPO" pull --ff-only origin main
bash "$CC_REPO/setup.sh"
```

If the user has hand-edits to `~/.claude/settings.json` (custom permissions, hooks, env), the installer preserves them automatically. Pass `--interactive` if they want to review each merge:

```bash
bash "$CC_REPO/setup.sh" --interactive
```

## Phase 6 — Verify and nudge

```bash
NEW=$(jq -r .version "$HOME/.claude/.cc-settings-version")
[ "$NEW" = "$LATEST" ] && echo "✓ Updated to $LATEST" || echo "⚠ Sentinel still reports $NEW (expected $LATEST)"
```

Then tell the user:

> **Restart Claude Code** to pick up the new agents/skills/hooks. New skills only auto-invoke after restart.

If the update introduced new MCP servers or env vars, mention those by name (read from the rendered CHANGELOG section in Phase 3).

## What this skill does NOT do

- It does not modify the `cc-settings` repo. Maintainer-facing sync work goes through `/cc-sync`.
- It does not rollback. If the new version misbehaves, run `bun "$CC_REPO/src/setup.ts" --rollback` to restore the most recent backup in `~/.claude/backups/`.
- It does not pin to a specific version. To install an older release, `git -C "$CC_REPO" checkout <tag>` first, then run `bash setup.sh` directly.
