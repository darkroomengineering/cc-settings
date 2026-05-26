# cc-settings

Claude Code configuration for the Darkroom team — installs agents, skills, hooks, and coding standards into `~/.claude/`.

---

## Install

```bash
# macOS / Linux
bash <(curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh)

# Windows (PowerShell)
.\setup.ps1
```

Requires [Bun](https://bun.sh) ≥ 1.1.30 — the bootstrap installs it automatically if missing. Re-installs are non-destructive: existing permissions, custom hooks, and local overrides survive.

Restart Claude Code after install.

---

## What gets installed

```
~/.claude/
├── AGENTS.md           # Portable coding standards (read by all AI tools)
├── CLAUDE.md           # Claude-Code-specific config
├── settings.json       # Composed from config/*.json (permissions, hooks, MCP)
├── agents/             # 9 specialized subagents
├── skills/             # 27 auto-invocable skills
├── profiles/           # Stack contexts: nextjs, react-native, tauri, webgl, maestro, react-router
├── rules/              # Path-conditioned rules (load on-demand by file type)
├── contexts/           # Ecosystem contexts
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

---

## Common commands

```bash
bash setup.sh                  # Install / update
bun src/setup.ts --rollback    # Restore the previous backup
bun src/setup.ts --dry-run     # Preview what would change
bun run compose                # Preview the composed settings.json
bun run lint:skills            # Validate skill frontmatter + cap (≤40)
bun run audit:hooks            # Classify hooks as trusted/unknown/suspicious
bun run typecheck              # TypeScript check
bun test                       # Run all tests
```

---

## Docs

| Doc | What's in it |
|-----|-------------|
| [MANUAL.md](./MANUAL.md) | Every skill — how to invoke it, what it does |
| [AGENTS.md](./AGENTS.md) | Coding standards and guardrails (source of truth) |
| [CLAUDE.md](./CLAUDE.md) | Claude-Code config, delegation rules, effort levels |
| [docs/profiles.md](./docs/profiles.md) | Stack-specific profiles (Next.js, RN, Tauri, WebGL, React Router) |
| [docs/skill-authoring.md](./docs/skill-authoring.md) | Writing new skills |
| [CHANGELOG.md](./CHANGELOG.md) | Release history |

---

## Why

Shared config means every engineer on the team runs the same agents, the same guardrails, and the same coding standards — no per-machine drift. `AGENTS.md` is the [open standard](https://agents.md) for AI coding instructions and is also read by Codex, Cursor, Copilot, and Windsurf, so the rules follow you across tools.

---

[darkroom.engineering](https://darkroom.engineering) · MIT
