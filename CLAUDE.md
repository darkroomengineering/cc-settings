# cc-settings

Darkroom Engineering Claude Code configuration repository.

## Important

The full CLAUDE.md instructions are in `CLAUDE-FULL.md`. The `setup.sh` installer
copies that file to `~/.claude/CLAUDE.md` where Claude Code loads it globally.
Do NOT duplicate the full config here -- it would be loaded twice per session
(once as global from `~/.claude/CLAUDE.md`, once as project from this file).

## About This Repo

This is a **bash/markdown configuration project**, not a Next.js app.
There is no TypeScript, no build step, and no `node_modules`.

### Structure

- `scripts/` - Bash scripts installed to `~/.claude/scripts/`
- `agents/` - Agent definitions installed to `~/.claude/agents/`
- `skills/` - Skill files installed to `~/.claude/skills/`
- `commands/` - Slash commands installed to `~/.claude/commands/`
- `rules/` - Path-conditioned rules installed to `~/.claude/rules/`
- `profiles/` - Profile definitions installed to `~/.claude/profiles/`
- `contexts/` - Ecosystem contexts installed to `~/.claude/contexts/`
- `hooks/` - Hook definitions installed to `~/.claude/hooks/`
- `lib/` - Shared bash libraries (colors.sh, platform.sh, prompts.sh, etc.)
- `tests/` - Test scripts for validation
- `setup.sh` - The installer entry point
- `settings.json` - Permissions, hooks, and MCP server config
- `CLAUDE-FULL.md` - Full instructions (installed to `~/.claude/CLAUDE.md`)

### Development

- Test installer changes: `bash setup.sh`
- Test safety net: `bash tests/safety-net-test.sh`
- Shared libraries in `lib/` are sourced by `setup.sh` and scripts
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
