# cc-settings

Darkroom Engineering Claude Code configuration repository.

This file is the repo's own project instructions. It lives at
`.claude/AGENTS.md` because the root `AGENTS.md` is an installed artifact, not
a place for repo notes. `.claude/settings.json` excludes that root copy from
this repo's own sessions (`claudeMdExcludes`), since the user `CLAUDE.md`
already imports the installed one; without it the standards load twice. Claude Code 2.1.277+ reads both natively when a
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

**TypeScript on Bun.** Runtime: `bun >=1.2.21`.
Deps: `zod` and `typescript` (the native-ts codemap engine loads the compiler at runtime; YAML parsing uses `Bun.YAML`, prompts use `node:readline`). Dev: `@biomejs/biome`, `@types/bun`.

**Skill library ratchets.** The managed library contains exactly 25 skills.
`SKILL_COUNT_BASELINE` in `src/lib/lint-skills.ts` fails when the count moves
either way. The description-byte ceiling is one-way: tighten the longest
descriptions when it fails; never raise the ceiling. `bun run lint:skills`
enforces both in CI.

**Hook supply-chain defense.** `setup.sh` fingerprints the merged hooks block in
`~/.claude/settings.json`; `verify-hooks.ts` checks it at SessionStart. `bun run
audit:hooks` classifies hook commands and fails on suspicious ones. After an
intentional hook change, rerun `setup.sh` to refresh the fingerprint; the
auditor never refreshes its own. When a hook is removed or renamed, add its old
command to `DEPRECATED_COMMAND_PATTERNS` in `src/lib/settings-merge.ts`. See
`SECURITY.md`.

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
- Tests: `bun run test` (runs `bun test --parallel`, one worker per CPU core)
- Token spend from local transcripts: `bun run tokens` (`--all`, `--days N`, `--json`). Price-weighted by billing type, split main vs subagent; run it before and after a harness change. A Codex section counts tokens (cost n/a) from `$CODEX_HOME` rollouts under the same flags, so work routed to Codex stays visible.
- Hook firing frequency from local transcripts: `bun run hooks:report` (`--days N`, `--project`, `--json`, `--bench <file>`). Maps tool calls, prompts, turns and compactions onto the matchers in `config/40-hooks.json` and lists the Stop hook `durationMs` Claude Code records.
- Hook latency replay: `bun run hooks:bench` (`--runs N`, `--json`). Runs each synchronous hook with a sample payload under a throwaway `HOME`, reports p50/p95. Feed its `--json` to `hooks:report --bench`.
- Skill evals: every skill has cases in `evals/<skill>-<slug>/` (`claude plugin eval` format, `tags: [<skill>]`). A repo-local hook (`.claude/hooks/pre-push-evals.ts`) runs the cases for skills changed since upstream before every `git push`, capped at $5, and blocks on a failing or missing case. Run it by hand with `bun src/scripts/eval-changed.ts`; a new or reworded skill ships with its case. A case can keep built-in tools such as Agent out of its runs with the `disallowed_tools` field (`--disallow-tools` on the command line).
- Eval regression rules: `bun src/scripts/eval-changed.ts --base-arm --runs 3` also runs the merge-base version and blocks when a case tagged `critical` passed every base run and failed any candidate run, or when a case of a changed skill was deleted, renamed, or untagged. A flaky case goes in `evals/quarantine.json` (`case`, `owner`, `expires` YYYY-MM-DD, `reason`) and stops blocking until it expires; an expired or malformed entry blocks.
- Trigger check after a description edit: `bun src/scripts/eval-triggers.ts <skill>` runs `evals/triggers/<skill>.json` (`should` and `near_miss` prompts with `min_recall` and `max_false_trigger`) through `claude -p` and scores whether the installed skill loads on the first turn; run `setup.sh` first, and expect about $3.40 for 20 prompts at 3 runs (est. from one 20-prompt run at $1.13 on 2026-10-21). Runs go out with prompt caching off: Claude Code puts the prompt ahead of the skill listing, so a cache write is never read back. Prompt sets exist for `fix`, `codex` and `refactor`; each threshold sits about one prompt below its calibrated rate (a prompt is 10 points of recall), so one unlucky prompt does not fail the check but a description that loses a prompt type does. `eval-changed.ts --triggers` runs it for each changed skill whose `description:` changed and warns when the skill has no prompt set. The pre-push hook passes neither flag.
- Vanilla comparison: `bun src/scripts/eval-ablate.ts` (`--tag`, `--case`, `--runs N`, opt-in `--max-cost-usd N`). Runs the eval cases with skills, agents and the standards (AGENTS.md, CLAUDE-FULL.md, output style, injected by SessionStart hooks) against vanilla Claude Code and lists the cases where vanilla scores as well. Not covered: settings.json hooks and permissions.
- Typecheck: `bun run typecheck`
- Lint: `bun run lint` / `bun run lint:fix`
- Deliberate-shortcut markers: `bun run lint:shortcuts` (add `-- --ledger` for the `/audit debt` view). Convention lives in AGENTS.md → Laziness Ladder.
- Schemas (regenerate JSON Schema from zod sources): `bun run schemas:emit`
- Preview composed settings.json: `bun run compose`
- Dry-run a Bash command against the permission rules: `bun run permissions:check "<cmd>"` (`--installed` to check against `~/.claude/settings.json` instead of `config/`)
- Upstream drift scan (Claude Code and Codex CLI): `bun run upstream:scan`
- Commits: conventional — `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`. A repo-local hook (`.claude/hooks/pre-commit-invariants.ts`) runs the fast invariant tests before every `git commit` and blocks on failure; the full suite still runs before a PR.
- Landing: main is protected. Every change, version bumps included, lands through a PR. The only required check is `ci-gate`, which the org ruleset "Default branch gate" runs from `darkroomengineering/.github` on every repo. `darky/review` is not required. PRs run Windows only for the install tests and `setup.ps1`; the full Windows suite runs after the merge, on main. Auto-merge is off, so merge by hand once `ci-gate` passes.
- When a change closes the bug a team-knowledge note documents, rewrite or delete that note in a team-knowledge PR opened alongside it (its `main` takes changes only through a PR; see `docs/knowledge-system.md`). A stale cc-settings note is worse than none: it prescribes a manual fix for a bug that no longer exists.
