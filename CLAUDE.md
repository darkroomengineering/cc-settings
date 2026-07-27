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

**TypeScript on Bun** (migrated from bash in April 2026; see git log for history). Runtime: `bun >=1.2.21`. Skill count and the soft cap of 40 are enforced by `bun run lint:skills` — provenance and the cap rule live in `CLAUDE-FULL.md` ("Skill library soft cap"), not here.
Deps: `zod` (only — `yaml` and `@inquirer/confirm` were dropped for `Bun.YAML`
and `node:readline`). Dev: `@biomejs/biome`, `typescript`, `@types/bun`.

Two directories aren't what their names suggest: `config/` holds settings
fragments that are *composed* into `~/.claude/settings.json` at install time
(edit those, never the installed file), and `schemas/*.schema.json` is
generated from the zod sources in `src/schemas/` — don't hand-edit it.

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
