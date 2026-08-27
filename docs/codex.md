# Codex support

> **Audience:** standalone Codex users and administrators
> **Purpose:** document Codex-native installation, daily use, lifecycle, and platform boundaries
> **Status:** supporting Codex reference; shared behavior lives in [host parity](./claude-vs-codex.md)

cc-settings installs a native Codex setup from the same source tree used for Claude Code. Use the
installer as the canonical setup path. Codex's `/import` command remains useful for migrating an
existing hand-tuned Claude Code profile, but it is no longer the recommended cc-settings setup.

For running Codex as a second model from a Claude Code session, see
[codex-bridge.md](./codex-bridge.md). This page covers standalone Codex installation and lifecycle.

After installation, describe outcomes normally or pin a shared skill as `$skill-name`. Claude-style
`/skill-name` examples do not apply in standalone Codex. Use `/status` for native session state and
`/hooks` to review plugin hooks. Follow [your first session](./first-session.md) for a harmless
read-only setup check.

## Install Codex

The default target is `auto`. It installs both Claude Code and Codex when the `codex` executable is
on `PATH`, and Claude Code only otherwise.

```bash
# Default target selection
bash setup.sh

# Codex only
bash setup.sh --target=codex

# Claude Code only
bash setup.sh --target=claude

# Both (full and plugin-changing operations require the CLI; a fresh --light does not)
bash setup.sh --target=both
```

On Windows, use `.\setup.ps1` in place of `bash setup.sh`. No clone is needed for any of these:
every flag also works remotely through `npx darkroom-settings --target=codex`, the shell one-liner
(`curl -fsSL .../setup.sh | bash -s -- --target=codex`), or the PowerShell script-block form — see
the [one-line install](./install.md#one-line-install).

Restart each selected TUI after installation. In Codex, open `/hooks` and review the newly installed
plugin hooks once. Repeat that review after a plugin hook changes. The fixed HTTPS Figma MCP may ask
you to authenticate in Codex.

## What a full Codex install manages

The installer uses `$CODEX_HOME` when it is set, or `~/.codex` otherwise:

```text
$CODEX_HOME/ or ~/.codex/
|-- AGENTS.md                    # Managed marked block; surrounding user text stays intact
|-- agents/*.toml               # Native role agents, except codex-verifier
|-- rules/darkroom.rules         # Native command policy
|-- darkroom/source/             # Allowlisted runtime source used by plugin hooks
|-- .cc-settings-version         # Ownership and version sentinel
`-- backups/cc-settings/         # Codex-specific backups
```

The full profile also installs `darkroom@cc-settings` through the native Codex plugin CLI. The
plugin provides:

- The 38 shared skills from this repository.
- The fixed HTTPS Figma MCP server.
- Codex-compatible lifecycle hooks.
- Codex UI metadata.

The Codex package does not auto-run Context7 or Chrome DevTools from mutable, unpinned registry
packages. Users may configure reviewed and pinned versions themselves. The package also excludes
Claude's `tldr` MCP server and the `codex-verifier` agent. That agent exists only to bridge from
Claude Code into Codex.

`darkroom/source` is a runtime allowlist, not a copy of the checkout. It contains only the shared
skills, hooks, runtime `src/` files, and package metadata needed after installation. Native role
instructions are generated separately in `agents/*.toml`. User-created files, ignored files, and
unrelated repository content are not copied into the managed runtime.

## If Codex says skill descriptions were shortened

A full install checks `~/.agents/skills` for names that duplicate skills already supplied by the
`darkroom@cc-settings` plugin. This usually comes from an older Codex `/import`. Duplicate entries
consume the skill selector's `skills.max_context_tokens` budget and can make Codex shorten otherwise
complete plugin descriptions. The installer reports the names but never moves them automatically.

Preview the migration from a cc-settings checkout:

```bash
bun run migrate:codex-skills
```

The preview lists only names that overlap the current 38 cc-settings skills. It leaves unrelated
user skills, including `context7-mcp` and `programa`, out of the move. It also reads
`$CODEX_HOME/config.toml`, or `~/.codex/config.toml` when `CODEX_HOME` is unset. When Codex
Desktop's `[desktop] external-agent-import-sync-enabled` setting is `true`, Desktop will recreate
directories after they move. Preview still lists the overlaps and warns about recurrence, but
`--apply` refuses to move anything or create a backup.

Disable that setting, quit and restart Codex completely, then preview again. cc-settings never
edits `config.toml`; you own that choice. After reviewing a warning-free list, apply explicitly:

```bash
bun run migrate:codex-skills --apply
```

The command moves each overlapping real directory into one timestamped
`~/.agents/skills-backup-cc-settings-*` directory. It never deletes a skill, never follows a
symlink, and stops if an overlapping entry is not a normal directory. A malformed TOML file or a
non-boolean import-sync value also stops the migration before any move. Keep the backup until Codex
has restarted and the skill picker shows the plugin descriptions normally.

## Light profile

Codex light is intentionally different from Claude light.

| Surface | Codex light | Codex full |
|---|---|---|
| Managed Darkroom block in `AGENTS.md` | Yes | Yes |
| Runtime source in `darkroom/source` | Yes | Yes |
| Version sentinel and backups | Yes | Yes |
| `darkroom@cc-settings` plugin | No | Yes |
| Native role agents | No | Yes |
| `rules/darkroom.rules` | No | Yes |

Claude light remains raw Claude Code plus its statusline and `share-learning` skill. The two light
profiles are not exact equivalents because each product has different native configuration
surfaces.

```bash
bash setup.sh --target=codex --light
```

Re-run without `--light` to switch back to the full profile. Switching from full to light removes
the installed Codex plugin along with the owned native agents and command rule.

## Reinstall, rollback, and uninstall

Every lifecycle command accepts the same target selector:

```bash
bash setup.sh --target=codex --dry-run
bash setup.sh --target=codex --status
bash setup.sh --target=codex --rollback
bash setup.sh --target=codex --rollback=20260819120000
bash setup.sh --target=codex --uninstall
```

Use `--target=claude` or `--target=both` with the same commands when appropriate. Claude and Codex
keep separate backup stores, but successful combined operations write one shared ID to both. Bare
combined rollback selects the newest common pair and ignores newer one-sided backups. An explicit
combined timestamp must identify exactly one common pair. Use product-specific rollback commands
when you intentionally want to select and verify independent older backups.

Reinstalls preserve unrelated Codex agents, rules, and text outside the marked `AGENTS.md` block. A
first install refuses to overwrite a same-name native agent or `darkroom.rules` file that the
sentinel does not own. Switching to light, rolling back, and uninstalling remove only native agent
files recorded in the sentinel. Uninstall removes the managed instruction block, source, sentinel,
plugin, and owned full-profile files. It leaves the backup directory in place.

Unknown flags and invalid flag values fail closed. The installer exits without selecting `auto` or
changing either product.

Use installer `--status` to inspect cc-settings install health. Use Codex `/status` for the current
Codex session.

## Platform boundaries

Codex CLI does not expose an arbitrary custom statusline API. Claude's custom statusline and its
quota chips therefore have no Codex equivalent. Codex `/status` shows native session status, while
`bash setup.sh --target=codex --status` reports the cc-settings installation.

Installed plugins are available in Codex CLI and desktop surfaces that support plugins. The Codex
IDE extension can use standalone skills, but it does not load installed plugins. IDE users need a
plugin-capable CLI or desktop surface, or skills installed directly at repository or user scope.

Several shared workflows have narrower Codex branches:

- `tldr` is not bundled. Shared workflows use `rg` and Codex native search instead.
- `$freeze` cannot enforce a directory edit lock in Codex.
- `$autoresearch` cannot run its Claude subprocess evaluation loop in Codex.
- Claude agent teams, dynamic workflows, and the custom statusline remain Claude-only.

## When to use `/import`

Use `/import` as a migration or fallback option when an existing Claude Code installation contains
carefully maintained personal configuration that you want Codex to translate. Native cc-settings
installation is the normal path because it writes Codex-native instructions, agents, rules, hooks,
and plugin configuration from current repository sources. It avoids carrying translated stale
paths or Claude-specific tool names into Codex.

Official references: [Import from another agent](https://learn.chatgpt.com/docs/import),
[Build skills](https://learn.chatgpt.com/docs/build-skills), and
[Package plugins](https://developers.openai.com/plugins/build/plugins).
