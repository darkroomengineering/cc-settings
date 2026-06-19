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

**TypeScript on Bun** (migrated from bash in April 2026; see git log for history). Runtime: `bun >=1.2.21`. Skills: 35 cc-settings skills (Tier P1 cleanup May 2026: retired 3, merged 7 pairs into 4, demoted 1 to CLI; `nuclear-review` ported from Cursor team-kit May 2026; share-learning revived May 2026; `freeze` edit-scope lock ported from gstack June 2026).
Deps: `zod` (only — `yaml` and `@inquirer/confirm` were dropped for `Bun.YAML`
and `node:readline`). Dev: `@biomejs/biome`, `typescript`, `@types/bun`.

### Structure

- `MANUAL.md` — User-facing guide (what you can do, how to do it)
- `AGENTS.md` — Portable coding standards (source of truth)
- `CLAUDE-FULL.md` — Claude-Code config (installed to `~/.claude/CLAUDE.md`)
- `src/setup.ts` — The installer
- `src/hooks/` — Hot-path hook implementations (PreToolUse, statusLine, …)
- `src/scripts/` — One-shot scripts (post-edit, handoff, …)
- `src/lib/` — Shared libs (colors, mcp, packages, platform, prompts, …)
- `src/schemas/` — zod schemas for settings.json, hooks, skills, MCP
- `src/upstream/` — Claude Code version-drift scanner
- `agents/` — Agent definitions installed to `~/.claude/agents/`
- `skills/` — Skill files installed to `~/.claude/skills/`
- `rules/` — Path-conditioned rules installed to `~/.claude/rules/`
- `profiles/` — Profiles installed to `~/.claude/profiles/`
- `hooks/` — Hook documentation (markdown)
- `mcp-configs/` — MCP server reference config
- `docs/` — Reference documentation
- `tests/` — bun:test suites
- `setup.sh` / `setup.ps1` — Tiny bootstraps (install Bun, exec `bun src/setup.ts`)
- `config/` — Settings fragments (source of truth; `10-core.json`, `20-mcp.json`, `30-permissions.json`, `40-hooks.json`). Composed into `~/.claude/settings.json` at install time. Run `bun run compose` to preview the composed output.
- `schemas/*.schema.json` — Generated JSON Schemas (via `bun run schemas:emit`)

### Development

- Install: `bash setup.sh` (macOS/Linux) or `.\setup.ps1` (Windows)
- Light install: `bash setup.sh --light` (raw Claude Code + statusline + `share-learning` skill only; permanent beginner tier — re-run without `--light` to upgrade)
- Rollback: `bun src/setup.ts --rollback` (restores newest backup)
- Dry-run: `bun src/setup.ts --dry-run`
- Tests: `bun test`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint` / `bun run lint:fix`
- Schemas (regenerate JSON Schema from zod sources): `bun run schemas:emit`
- Preview composed settings.json: `bun run compose`
- Upstream drift scan: `bun run upstream:scan`
- Commits: conventional — `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`.
