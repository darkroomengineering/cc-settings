# /cc update: restart only when needed

## Before setup.sh (update Phase 5)

Snapshot the installed file hashes and the settings `env` block; the check below compares them.

```bash
SNAP=$(mktemp -d)
jq '.managed_files // {}' "$CLAUDE_SENTINEL" > "$SNAP/before.json" 2>/dev/null || echo '{}' > "$SNAP/before.json"
jq -S '.env // {}' "$HOME/.claude/settings.json" > "$SNAP/env-before.json" 2>/dev/null || echo '{}' > "$SNAP/env-before.json"
```

## After setup.sh (update Phase 6)

For Claude, a running session already picks up settings, hooks, permissions,
skills, agents, the statusline and hook scripts. It reads `CLAUDE.md`, the
`AGENTS.md` and `personal.md` it imports, `rules/`, output style files and the
settings `env` block only at launch. List what changed in that second group:

```bash
RESTART_FOR=$(jq -r --slurpfile b "$SNAP/before.json" '
  (.managed_files // {}) | to_entries[]
  | select(.value != ($b[0][.key] // null)) | .key
  | select(test("^(CLAUDE|AGENTS|personal)\\.md$|^rules/|^output-styles/"))' "$CLAUDE_SENTINEL")
jq -S '.env // {}' "$HOME/.claude/settings.json" | cmp -s - "$SNAP/env-before.json" \
  || RESTART_FOR=$(printf '%s\nsettings.json env' "$RESTART_FOR")
RESTART_FOR=$(printf '%s' "$RESTART_FOR" | sed '/^$/d')
printf '%s\n' "${RESTART_FOR:-none}"
```

- **Nothing listed:** say "no restart needed", name the version, and continue
  whatever task was running before the update.
- **Something listed:** write a handoff, leave the resume marker, and ask the
  user to run `/restart` (Claude Code 2.1.288+; on a plan or install without
  it, exit and run `claude --continue`). The resumed session's SessionStart
  hook reads the marker once, in this directory, within two hours, and points
  Claude at the handoff, so the user only types "continue".

```bash
HANDOFF=$(bun "$HOME/.claude/src/scripts/handoff.ts" create --summary "<one line: the task in progress and its next step>" \
  | sed -n 's/^ *MD: *//p' | head -1)
# cwd is the directory the session started in (the environment's primary
# working directory), not wherever the shell has since cd'd: the hook compares
# against it.
jq -n --arg cwd "<session's primary working directory>" --arg version "$LATEST" --arg handoff "$HANDOFF" \
  --arg restart "$RESTART_FOR" --argjson at "$(($(date +%s) * 1000))" \
  '{cwd: $cwd, version: $version, at: $at,
    restartFor: ($restart | split("\n") | map(select(. != ""))),
    handoff: (if $handoff == "" then null else $handoff end)} | with_entries(select(.value != null))' \
  > "$HOME/.claude/tmp/update-resume.json"
```

Tell the user which files need the restart, then the one action: run `/restart`
and type "continue". A combined update needs both restarts and both sentinel
checks.
