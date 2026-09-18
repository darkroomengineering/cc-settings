---
name: cc
argument-hint: "[sync|update|migrate]"
description: Sync cc-settings with Claude Code and Codex upstreams, update a local install, or migrate a project's CLAUDE.md to AGENTS.md. Triggers "sync with claude code", "update cc-settings", "migrate to agents.md".
---

# cc — cc-settings management

Three-mode skill: **sync** keeps the repo current with the Claude Code and
Codex CLI upstreams (maintainer task); **update** refreshes the active Claude
Code, Codex, or combined local install (everyone); **migrate** moves a
project's `CLAUDE.md` into `AGENTS.md` so every coding agent reads one file.

## Mode: sync

Audit cc-settings against the Claude Code changelog and the Codex release
notes; identify features to adopt and duplication to remove; stops for approval.

Track both upstreams and keep cc-settings (schemas, config, hooks, agents,
docs, the Codex installer surfaces) in sync with new features. Removes anything
that duplicates native functionality.

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
`@anthropic-ai/claude-code` npm version and `upstream/codex-manifest.json`
against the live `@openai/codex` npm version. Each upstream has two outcomes:

- **No drift** — manifest matches live. Nothing to sync for that upstream.
- **Drift detected** — capture both versions. Format: `manifest=A → live=B`.

If neither drifts, tell the user "already in sync at Claude Code v<X>, Codex
v<Y>" and end. If only one drifts, run the remaining phases for that upstream
alone and say so in the plan.

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

#### Codex

Codex publishes release notes per GitHub release, not a changelog file. Stable
releases are tagged `rust-v<X>`; alpha tags and Python SDK tags are not
tracked. List the stable versions after the manifest version, then read each
release body verbatim:

```bash
gh release list -R openai/codex --exclude-pre-releases --limit 20 \
  | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\s' | awk '{print $1}'
gh release view rust-v<X> -R openai/codex --json body --jq '.body'
```

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

For Codex changes, cross-reference these surfaces instead. There is no zod
schema for any of them; `upstream/codex-manifest.json` `knownConfigSurfaces`
lists what the installer writes or reads so a release note that names one is
easy to spot.

| Bucket | What to check |
|---|---|
| Native agents (`agents/*.toml` fields) | `src/lib/codex-native-agents.ts`, `codex/agents/` |
| Command policy (`rules/*.rules`) | `codex/rules/darkroom.rules` |
| Plugin manifest and hooks | `.codex-plugin/plugin.json`, `hooks/hooks.json`, `src/lib/codex-runtime-manifests.ts` |
| `config.toml` keys the installer reads | `src/lib/codex-install-state.ts`, `src/lib/codex-skill-budget.ts` |
| Skill loading and budgets | `src/lib/lint-skills.ts`, `docs/codex.md` "skill descriptions were shortened" |
| Bridge (`codex exec`, `codex review`, model pins) | `src/lib/claude-bridge.ts`, `codex-run.ts`, `docs/codex-bridge.md` |
| User-facing docs | `docs/codex.md`, `codex/AGENTS.append.md` |

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
## Claude Code v<A> → v<B>, Codex v<C> → v<D> sync plan

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
contract), then config, then docs. Codex adoptions have no schema step: edit
the installer surface, then `docs/codex.md`. For deduptions, delete the orphaned code
and any tests that asserted on it.

After each schema edit, also update `upstream/claude-code-manifest.json`
(`knownSettingsKeys`, `knownHookTypes`, `knownEnvVars`) — the scanner uses
this as the source of truth.

### Phase 6 — Manifest bump + version bump + CHANGELOG

```
upstream/claude-code-manifest.json
  - claudeCodeVersion: "<B>"
  - lastScan: <today ISO>
  - notes: append one entry summarizing the window (adopted, docs-only, skipped)
upstream/codex-manifest.json
  - codexVersion: "<D>"
  - lastScan: <today ISO>
  - notes: append one entry; add any new surface to knownConfigSurfaces
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
bun run upstream:scan   # should now show "no drift detected" for both upstreams
bun run compose | head  # spot-check that new fields surface in settings.json
```

If any fail: fix before moving on. Tests must pass.

### Phase 8 — Commit + push

```bash
git add -A
git commit -m "feat(v<new-version>): sync with Claude Code v<B> and Codex v<D>

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

1. **Upstream** — what Claude Code and Codex do today. Source: the Claude
   Code changelog and the Codex GitHub release notes.
2. **Manifest** — what cc-settings believes upstream does. Source:
   `upstream/claude-code-manifest.json` and `upstream/codex-manifest.json`.
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

---

## Mode: migrate

Move a project's `CLAUDE.md` into `AGENTS.md`. Since Claude Code 2.1.277 a
project with no `CLAUDE.md` gets its `AGENTS.md` read natively as project
instructions, framed exactly like a `CLAUDE.md`, with `.claude/rules/` still
loading alongside. Codex, Cursor, and Copilot already read `AGENTS.md`. Keeping
a `CLAUDE.md` around means Claude Code ignores the `AGENTS.md` and the two
files drift. The SessionStart banner prints a one-line hint whenever a
`CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` exists in the project
root; this mode is the action behind that hint.

Run it from the project root. It touches only that project's files, never
`~/.claude/CLAUDE.md`, which has no AGENTS.md fallback and stays as installed.

### Phase 1 — Inventory

```bash
git rev-parse --show-toplevel
for f in CLAUDE.md .claude/CLAUDE.md CLAUDE.local.md AGENTS.md .claude/AGENTS.md; do
  [ -f "$f" ] && printf '%s\t%s bytes\n' "$f" "$(wc -c < "$f")"
done
grep -n '^@' CLAUDE.md .claude/CLAUDE.md 2>/dev/null
```

Read every file found. Then classify:

- **Rename** — a `CLAUDE.md` and no `AGENTS.md`. The whole file moves.
- **Merge** — both exist. Read both; the content that is only in `CLAUDE.md`
  goes into `AGENTS.md` under a heading that names its topic (never a heading
  called "From CLAUDE.md"), duplicated guidance is dropped, and a conflict is
  listed for the user instead of resolved silently.
- **Already imported** — `CLAUDE.md` is only an `@AGENTS.md` line (plus blank
  lines). Delete it; the import was the pre-2.1.277 workaround.
- **Leave** — `CLAUDE.local.md` is personal and uncommitted. Report it, do not
  move it, and say that its presence alone blocks the native read; the user
  can set Project instructions to `claude-md-and-agents-md` in `/config` or
  fold the file into their own notes.

Claude-only content (output style, `/effort`, hook, or subagent notes) still
goes to `AGENTS.md`: other agents ignore what they do not understand, and one
file is the point. Only when the user objects, keep a `CLAUDE.md` holding
`@AGENTS.md` followed by the Claude-only lines.

### Phase 2 — Show the plan and stop

Print the classification, the target file, the byte counts, and, for a merge,
the sections that will move and any conflicts. Wait for approval. Do not edit
before it.

### Phase 3 — Apply

```bash
git mv CLAUDE.md AGENTS.md            # rename case
# merge case: edit AGENTS.md, then
git rm CLAUDE.md
# .claude/CLAUDE.md follows the same two paths into .claude/AGENTS.md
```

Then fix references: `grep -rn 'CLAUDE\.md' --include='*.md' --include='*.json'
--include='*.ts' --include='*.yml' .` excluding `node_modules`. Update paths
that pointed at the moved file (README setup notes, CI steps that cat it,
`claudeMdExcludes` patterns). Leave mentions of `~/.claude/CLAUDE.md` alone.

### Phase 4 — Verify

Start a new Claude Code session in the project (or `claude -p 'what are your
project instructions?'`) and look for the line
`no CLAUDE.md found; AGENTS.md loaded: <path>`. `/memory` and `/context` do not
list an `AGENTS.md` read this way, so that line is the check. If the line is
missing, the session is one that cannot load `AGENTS.md` (Bedrock, telemetry
off, `disableAllHooks`, or the first session after the upgrade); say so and
offer the one-line `CLAUDE.md` that holds `@AGENTS.md` as the fallback.

Commit as `chore: move CLAUDE.md into AGENTS.md` on the project's usual branch
flow (cc-settings pushes to main; client projects open a PR through `/ship`).

