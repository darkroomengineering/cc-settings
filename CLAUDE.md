# cc-settings

Darkroom Engineering Claude Code configuration repository.

## Important

This repo contains two config files installed globally:
- `AGENTS.md` → `~/.claude/AGENTS.md` (portable coding standards, reference copy)
- `CLAUDE-FULL.md` → `~/.claude/CLAUDE.md` (Claude-Code-specific config)

The `AGENTS.md` file is the source of truth for coding standards and guardrails.
It works across all AI coding tools (Codex, Cursor, Copilot, Windsurf, etc.).

`CLAUDE-FULL.md` contains only Claude-Code-specific settings (edit strategy,
delegation guidance, model config, profiles, hooks). It points to AGENTS.md
for standards.

## About This Repo

This is a **bash/markdown configuration project**, not a Next.js app.
There is no TypeScript, no build step, and no `node_modules`.

### Structure

- `AGENTS.md` - Portable coding standards (source of truth)
- `CLAUDE-FULL.md` - Claude-Code config (installed to `~/.claude/CLAUDE.md`)
- `scripts/` - Bash scripts installed to `~/.claude/scripts/`
- `agents/` - Agent definitions installed to `~/.claude/agents/`
- `skills/` - Skill files installed to `~/.claude/skills/`
- `rules/` - Path-conditioned rules installed to `~/.claude/rules/`
- `profiles/` - Profiles installed to `~/.claude/profiles/`
- `contexts/` - Ecosystem contexts installed to `~/.claude/contexts/`
- `hooks/` - Hook documentation and guidelines
- `mcp-configs/` - MCP server configuration
- `lib/` - Shared bash libraries
- `docs/` - Reference documentation
- `tests/` - Test scripts for validation
- `setup.sh` - The installer entry point
- `settings.json` - Permissions, hooks, and MCP config

### Development

- Test installer changes: `bash setup.sh`
- Test safety net: `bash tests/safety-net-test.sh`
- Shared libraries in `lib/` are sourced by `setup.sh` and scripts
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`

# currentDate
Today's date is 2026-02-23.
