# Installation Reference

Everything about getting cc-settings onto a machine — one-liners, flags, tiers, and what lands where. The short version lives in the [README](../README.md); this is the detail.

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

Both one-liners clone the repo and run the installer. To pass flags (`--light`, `--dry-run`, …), clone first and run the bootstrap from the checkout: `bash setup.sh --light` or `.\setup.ps1 --light`.

## Requirements

Requires [Bun](https://bun.sh) ≥ 1.2.21 and git — the bootstrap installs Bun automatically if missing. The full profile also installs `jq` if missing; no runtime hook shells out to it (all hooks are TypeScript) — it's for the `jq` one-liners used in team-knowledge remediation runbooks. Re-installs are non-destructive: existing permissions, custom hooks, and local overrides survive.

Restart Claude Code after install.

## Light profile (for newcomers)

New to Claude Code and don't want the full surface? Install the **light** profile — raw Claude Code with only two additions: the statusline and the `share-learning` skill.

```bash
bash setup.sh --light    # macOS / Linux
.\setup.ps1 --light      # Windows (PowerShell)
```

No custom CLAUDE.md, agents, rules, profiles, MCP servers, hooks (beyond the statusline), or effort overrides — just vanilla Claude Code so you're not overwhelmed. Re-run `bash setup.sh` without `--light` any time to upgrade to the full config; both tiers are permanently supported. See [MANUAL.md](../MANUAL.md#install-tiers-light-vs-full) for the full comparison.

## What gets installed

```
~/.claude/
├── AGENTS.md           # Portable coding standards (read by all AI tools)
├── CLAUDE.md           # Claude-Code-specific config
├── settings.json       # Composed from config/*.json (permissions, hooks)
├── agents/             # 10 specialized subagents
├── skills/             # 38 auto-invocable skills
├── profiles/           # Stack contexts: nextjs, react-native, tauri, webgl, maestro, react-router
├── rules/              # Path-conditioned rules (load on-demand by file type)
└── src/                # Hook + script implementations (TypeScript)
```

Repo → install mapping:

| Repo dir | Installs to |
|----------|-------------|
| `agents/` | `~/.claude/agents/` |
| `skills/` | `~/.claude/skills/` |
| `rules/` | `~/.claude/rules/` |
| `profiles/` | `~/.claude/profiles/` |
| `config/*.json` | `~/.claude/settings.json` (composed) |
| `config/20-mcp.json` | `~/.claude.json` (MCP servers — the only file Claude Code loads user-scope servers from) |

The MCP fragment is installed to `~/.claude.json` — the only file Claude Code loads user-scope MCP servers from. The installer also writes two tamper-detection baselines: a SHA256 fingerprint of the merged hooks block, and a content manifest of the installed `src/` tree (see [SECURITY.md](../SECURITY.md)).

## Common commands

```bash
bash setup.sh                  # Install / update (full profile)
bash setup.sh --light          # Light profile: raw CC + statusline + share-learning only
bun src/setup.ts --rollback    # Restore the previous backup
bun src/setup.ts --dry-run     # Preview what would change
bun src/setup.ts --status      # Installed vs. packaged version
bun run compose                # Preview the composed settings.json
bun run lint:skills            # Validate skill frontmatter + count ratchet (baseline 38)
bun run escalate:stats         # Fired-vs-acted act-rate for the escalation advisory
bun run audit:hooks            # Classify hooks as trusted/unknown/suspicious
bun run typecheck              # TypeScript check
bun test                       # Run all tests
```
