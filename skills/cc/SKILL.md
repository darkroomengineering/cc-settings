---
name: cc
argument-hint: "[sync|update]"
description: Synchronizes cc-settings with Claude Code upstream (maintainer) or updates a Claude Code, Codex, or combined local install (user). Triggers "sync with claude code", "changelog sync", "upstream sync" (sync mode); "update cc-settings", "refresh my install" (update mode).
---

# cc — cc-settings management

Two-mode skill: **sync** keeps the repo current with Claude Code upstream
(maintainer task); **update** refreshes the active Claude Code, Codex, or
combined local install (everyone). Sync does not track a Codex upstream.

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
- It does not auto-open PRs, and there is no longer an automated cron. The
  daily upstream-sync GitHub Action was retired — it could only bump the
  version number, never triage the changelog. `bun run upstream:scan` is the
  manual drift detector; this skill is the only sync path.
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

Pull the latest cc-settings into the active host. Choose the target before
looking for a checkout:

1. An explicit request for both products selects `both`.
2. A standalone Codex session selects `codex`.
3. Otherwise select `claude`.

Never treat `${CODEX_HOME:-$HOME/.codex}/darkroom/source` as a checkout. It is
a copied, non-git runtime allowlist and must never be pulled.

### Phase 1 — Locate the real working repo

Read `repo_path` from the selected product sentinel first. For `both`, try the
Codex sentinel before the Claude sentinel. Then try known checkout paths. Every
candidate must contain `.git` and have the expected origin.

```bash
CODEX_ROOT="${CODEX_HOME:-$HOME/.codex}"
TARGET="codex" # use claude or both according to the host/explicit request above
CODEX_SENTINEL="$CODEX_ROOT/.cc-settings-version"
CLAUDE_SENTINEL="$HOME/.claude/.cc-settings-version"
CODEX_RUNTIME="$CODEX_ROOT/darkroom/source"

candidate_from_sentinel() {
  jq -r '.repo_path // empty' "$1" 2>/dev/null
}

CANDIDATES=()
if [ "$TARGET" = "codex" ] || [ "$TARGET" = "both" ]; then
  CANDIDATES+=("$(candidate_from_sentinel "$CODEX_SENTINEL")")
fi
if [ "$TARGET" = "claude" ] || [ "$TARGET" = "both" ]; then
  CANDIDATES+=("$(candidate_from_sentinel "$CLAUDE_SENTINEL")")
fi
CANDIDATES+=("$CODEX_ROOT/cc-settings" "$HOME/.claude/cc-settings" "$PWD")

CC_REPO=""
for candidate in "${CANDIDATES[@]}"; do
  [ -n "$candidate" ] || continue
  [ "$candidate" != "$CODEX_RUNTIME" ] || continue
  [ -d "$candidate/.git" ] || continue
  ORIGIN=$(git -C "$candidate" remote get-url origin 2>/dev/null) || continue
  NORMALIZED_ORIGIN=$(printf '%s' "$ORIGIN" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s:/+$::; s:[.]git$::')
  [ "$NORMALIZED_ORIGIN" = "https://github.com/darkroomengineering/cc-settings" ] || continue
  CC_REPO="$candidate"
  break
done

if [ -z "$CC_REPO" ]; then
  echo "No real cc-settings git checkout was found. Provide its path; the Codex runtime copy cannot be updated with git pull."
  exit 1
fi
```

Fail closed and ask for the real checkout path if none passes. Do not clone or
guess a path automatically.

### Phase 2 — Detect drift

```bash
case "$TARGET" in
  codex) INSTALLED=$(jq -r '.version // empty' "$CODEX_SENTINEL" 2>/dev/null) ;;
  claude) INSTALLED=$(jq -r '.version // empty' "$CLAUDE_SENTINEL" 2>/dev/null) ;;
  both)
    CODEX_INSTALLED=$(jq -r '.version // empty' "$CODEX_SENTINEL" 2>/dev/null)
    CLAUDE_INSTALLED=$(jq -r '.version // empty' "$CLAUDE_SENTINEL" 2>/dev/null)
    INSTALLED="codex=$CODEX_INSTALLED claude=$CLAUDE_INSTALLED"
    ;;
esac

git -C "$CC_REPO" fetch --quiet origin main
LATEST=$(git -C "$CC_REPO" show origin/main:src/setup.ts | grep -E '^const VERSION' | sed -E 's/.*"([0-9.]+)".*/\1/')
echo "Installed: $INSTALLED"
echo "Latest:    $LATEST"
```

If every selected sentinel already matches, report "already up to date" and
stop. If an installed version is newer than latest, surface the discrepancy and
ask before changing anything.

### Phase 3 — Render what changed

```bash
git -C "$CC_REPO" log --oneline "HEAD..origin/main" | head -20
git -C "$CC_REPO" show origin/main:CHANGELOG.md | sed -n '1,160p'
```

Display the relevant commits and changelog entries. **Stop and wait for
confirmation** before applying.

### Phase 4 — Pre-flight safety

```bash
if ! git -C "$CC_REPO" diff --quiet || ! git -C "$CC_REPO" diff --cached --quiet; then
  git -C "$CC_REPO" status --short
  echo "Commit, stash, or discard the checkout changes before updating."
  exit 1
fi

BRANCH=$(git -C "$CC_REPO" branch --show-current)
[ "$BRANCH" = "main" ] || {
  echo "The checkout is on '$BRANCH', not main. Switch first or update manually."
  exit 1
}
```

### Phase 5 — Apply

```bash
git -C "$CC_REPO" pull --ff-only origin main
bash "$CC_REPO/setup.sh" --target="$TARGET"
```

Claude-only update uses `--target=claude`; standalone Codex uses
`--target=codex`; an explicit combined update uses `--target=both`. Add
`--interactive` only when the user asks to review the merge.

### Phase 6 — Verify and nudge

```bash
[ "$TARGET" = "claude" ] || test "$(jq -r .version "$CODEX_SENTINEL")" = "$LATEST"
[ "$TARGET" = "codex" ] || test "$(jq -r .version "$CLAUDE_SENTINEL")" = "$LATEST"
```

For Claude, tell the user to restart Claude Code. For Codex, tell the user to
restart Codex. If plugin files changed, also tell the Codex user to review
`/hooks` and confirm the new hook commands remain trusted. A combined update
requires both restarts and both sentinel checks.

### Rollback

Rollback names the same target explicitly:

```bash
bash "$CC_REPO/setup.sh" --target=codex --rollback   # Codex
bash "$CC_REPO/setup.sh" --target=claude --rollback  # Claude Code
bash "$CC_REPO/setup.sh" --target=both --rollback    # explicit combined install
```

To install an older release, check out that release in the real working repo
first, then run `setup.sh` with the selected target. Never modify or pull the
Codex runtime copy directly.
