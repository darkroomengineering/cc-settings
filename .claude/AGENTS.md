# cc-settings

Darkroom Engineering Claude Code configuration repository.

This file is the repo's own project instructions. It lives at
`.claude/AGENTS.md` because the root `AGENTS.md` is an installed artifact, not
a place for repo notes. Claude Code 2.1.277+ reads both natively when a
project has no `CLAUDE.md`; Codex reads only the root file.

## Important

This repo contains two config files installed globally:
- `AGENTS.md` → `~/.claude/AGENTS.md` (portable coding standards, reference copy)
- `CLAUDE-FULL.md` → `~/.claude/CLAUDE.md` (Claude-Code-specific config)

The `AGENTS.md` file is the source of truth for coding standards and guardrails.
It works across all AI coding tools (Codex, Cursor, Copilot, Windsurf, etc.).

`CLAUDE-FULL.md` contains only Claude-Code-specific settings (edit strategy,
delegation guidance, model config, profiles, hooks). It `@`-imports AGENTS.md,
so the standards load every turn.

## About This Repo

**TypeScript on Bun.** Runtime: `bun >=1.2.21`. The skill count is enforced by `bun run lint:skills`; the rule lives in `CLAUDE-FULL.md` ("Skill library ratchets"), not here.
Deps: `zod` only (YAML parsing uses `Bun.YAML`, prompts use `node:readline`). Dev: `@biomejs/biome`, `typescript`, `@types/bun`.

Two directories aren't what their names suggest: `config/` holds settings
fragments that are *composed* into `~/.claude/settings.json` at install time
(edit those, never the installed file), and `schemas/*.schema.json` is
generated from the zod sources in `src/schemas/` — don't hand-edit it.

### Development

- Install: `bash setup.sh` (macOS/Linux) or `.\setup.ps1` (Windows)
- Light install: `bash setup.sh --light` (raw Claude Code + statusline + `share-learning` skill only; permanent beginner tier — re-run without `--light` to upgrade)
- Rollback: `bun src/setup.ts --rollback` (restores newest backup)
- Fresh install: `bash setup.sh --fresh` (reinstall as if from scratch — settings.json, prior-install state, and local approvals reset; login/history/memory untouched; recover via rollback)
- Dry-run: `bun src/setup.ts --dry-run`
- Tests: `bun test`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint` / `bun run lint:fix`
- Deliberate-shortcut markers: `bun run lint:shortcuts` (add `-- --ledger` for the `/audit debt` view). Convention lives in AGENTS.md → Laziness Ladder.
- Schemas (regenerate JSON Schema from zod sources): `bun run schemas:emit`
- Preview composed settings.json: `bun run compose`
- Dry-run a Bash command against the permission rules: `bun run permissions:check "<cmd>"` (`--installed` to check against `~/.claude/settings.json` instead of `config/`)
- Upstream drift scan (Claude Code and Codex CLI): `bun run upstream:scan`
- Commits: conventional — `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`. A repo-local hook (`.claude/hooks/pre-commit-invariants.ts`) runs the fast invariant tests before every `git commit` and blocks on failure; the full suite still runs before a PR.
- When a change closes the bug a team-knowledge note documents, rewrite or delete that note in the same push (`gh api` on `darkroomengineering/team-knowledge`, see `docs/knowledge-system.md`). A stale cc-settings note is worse than none: it prescribes a manual fix for a bug that no longer exists.
