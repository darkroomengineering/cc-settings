# Installation Reference

One installer configures Claude Code, Codex, or both. This page covers one-liners, targets, tiers,
lifecycle commands, and installed files. The short version lives in the [README](../README.md).

---

## One-liners

**macOS / Linux:**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh)
```

**Windows (PowerShell):**

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.ps1 | iex"
```

The one-liners clone the repository and run the default `auto` target. They cannot forward flags.
Clone the repository before using `--target`, `--light`, `--dry-run`, or another flag:

```bash
git clone https://github.com/darkroomengineering/cc-settings.git
cd cc-settings
bash setup.sh --target=codex
```

On Windows, use `.\setup.ps1` in place of `bash setup.sh`.

## Requirements

cc-settings requires [Bun](https://bun.sh) 1.2.21 or newer and git. The bootstrap installs Bun
automatically when it is missing. The full Claude profile also installs `jq` when needed for the
team-knowledge remediation commands. Runtime hooks themselves are TypeScript and do not shell out
to `jq`.

Full Codex installation and lifecycle operations that change plugin enrollment require the `codex`
executable. A fresh `--target=codex --light` install does not. The full Codex profile includes the
fixed HTTPS Figma MCP server, which may ask you to authenticate in Codex.

Restart every selected TUI after installation. For Codex, open `/hooks` and complete the one-time
trust review for the installed plugin hooks. Review them again after a hook change.

## Select a target

Use `--target=auto|claude|codex|both` with installation and every lifecycle command.
Unknown flags and invalid values fail closed without changing either product.

| Target | Behavior |
|---|---|
| `auto` | Default. Installs both when `codex` is on `PATH`; installs Claude Code only otherwise. |
| `claude` | Manages only `~/.claude`. |
| `codex` | Manages only `$CODEX_HOME` or `~/.codex`. |
| `both` | Manages Claude Code and Codex in the same run. |

```bash
bash setup.sh --target=auto
bash setup.sh --target=claude
bash setup.sh --target=codex
bash setup.sh --target=both
```

## Full and light profiles

The full profile is the default. The meaning of `--light` depends on the selected product.

| Product | Light profile | Full profile |
|---|---|---|
| Claude Code | Raw Claude Code plus the custom statusline and `share-learning` skill. | Instructions, settings, all skills, role agents, rules, profiles, MCP servers, and hooks. |
| Codex | Keeps the managed Darkroom `AGENTS.md` block and runtime source. Skips the plugin, native role agents, and command rule. | Managed instructions and source, native role agents, command rule, and `darkroom@cc-settings` plugin. |

Both tiers keep a product-specific version sentinel and backups. Re-run without `--light` to move
from light to full. Re-run with `--light` to move from full to light.

```bash
bash setup.sh --target=claude --light
bash setup.sh --target=codex --light
bash setup.sh --target=both --light
```

Claude light and Codex light are not exact equivalents. Claude light removes the managed
instructions and leaves a nearly raw Claude Code profile. Codex light retains the Darkroom
instructions because they are the minimal useful native Codex layer.

## What gets installed

### Claude Code

```text
~/.claude/
|-- AGENTS.md           # Portable coding standards
|-- CLAUDE.md           # Claude-Code-specific behavior
|-- settings.json       # Composed permissions, hooks, statusline, and environment
|-- agents/             # Specialized Claude Code subagents
|-- skills/             # 38 shared skills
|-- profiles/           # Stack contexts
|-- rules/              # Path-conditioned rules
`-- src/                # Hook and script implementations
```

The Claude MCP fragment installs to `~/.claude.json`, which is the user-scope MCP location Claude
Code reads. The full Claude profile configures `context7`, `tldr`, `figma`, and `chrome-devtools`.

### Codex

The Codex root is `$CODEX_HOME` when set, or `~/.codex` otherwise.

```text
$CODEX_HOME/ or ~/.codex/
|-- AGENTS.md                    # Marked managed block; unrelated text is preserved
|-- agents/*.toml               # Native role agents, except codex-verifier
|-- rules/darkroom.rules         # Native command policy
|-- darkroom/source/             # Allowlisted runtime source
|-- .cc-settings-version         # Ownership and version sentinel
`-- backups/cc-settings/         # Codex-specific backups
```

The full Codex profile also installs the `darkroom@cc-settings` native plugin. It provides the 38
shared skills, Codex-compatible lifecycle hooks, Codex UI metadata, and the fixed HTTPS Figma MCP
server. Codex does not auto-run Context7 or Chrome DevTools from unpinned registry packages. Users
may configure reviewed and pinned versions themselves. Claude's `tldr` MCP server is not bundled.

The managed source is a runtime allowlist rather than a checkout mirror. User-created files,
ignored files, and unrelated repository content are not copied into `darkroom/source`.

## Ownership-aware reinstalls

Claude reinstalls preserve user permissions, custom hooks, local overrides, and custom MCP servers.
Codex reinstalls preserve unrelated native agents, rules, and text outside the marked block in
`AGENTS.md`.

A first Codex install refuses to overwrite a same-name role agent or `darkroom.rules` file that is
not recorded as cc-settings-owned. Light switches, rollbacks, and uninstall remove only native
agent files listed in the sentinel. Codex uninstall leaves `backups/cc-settings` in place.

## Lifecycle commands

The bootstrap forwards lifecycle flags to the TypeScript installer when it runs from a checkout:

```bash
bash setup.sh --target=both --dry-run       # Preview both products
bash setup.sh --target=both --status        # Report install health for both products
bash setup.sh --target=both --rollback      # Restore the newest paired backup
bash setup.sh --target=both --uninstall     # Remove managed state from both products
```

`--migrate-only` is Claude-only. `--target=codex` rejects it. `--target=both` runs the Claude
migration and explicitly skips Codex.

Claude and Codex keep separate backup stores. Successful `--target=both` operations write the same
shared backup ID to each store. Bare combined rollback selects the newest common pair and ignores a
newer one-sided backup left by a failed operation. Claude stores archives under
`~/.claude/backups`; Codex stores snapshots under `$CODEX_HOME/backups/cc-settings` or
`~/.codex/backups/cc-settings`.

An explicit timestamp used with `--target=both` must identify exactly one common pair. Prefer
product-specific commands when intentionally choosing independent older backups:

```bash
bash setup.sh --target=claude --rollback=20260819120000
bash setup.sh --target=codex --rollback=20260819120000
```

Uninstall removes only managed state. Product-specific backups remain available afterward.

## Common maintainer commands

```bash
bun src/setup.ts --target=auto --status   # Installed vs packaged health
bun run compose                           # Preview Claude's composed settings.json
bun run lint:skills                       # Validate skill frontmatter and count ratchet
bun run escalate:stats                    # Escalation advisory act rate
bun run audit:hooks                       # Audit Claude hooks
bun run typecheck                         # TypeScript check
bun test                                  # Run all tests
```

Codex `/status` reports the current Codex session. Installer `--status` reports whether cc-settings
is installed and complete. Codex CLI does not provide an arbitrary custom statusline API, so the
Claude custom statusline and quota chips have no Codex equivalent.

Installed plugins work in Codex CLI and desktop surfaces that support plugins. The Codex IDE
extension can use standalone skills, but it does not load installed plugins. IDE users need a
plugin-capable CLI or desktop surface, or skills installed directly at repository or user scope.

See [Codex support](./codex.md) for the native Codex package and `/import` migration boundary.
