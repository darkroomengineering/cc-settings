# Migration Coexistence — `CC_USE_TS_HOOKS=1`

> Contract for running the bash and TypeScript hook implementations side-by-side
> during the Phase 1–7 migration. Source: `~/Desktop/cc-settings-MIGRATION.md` v2.
> **Frozen** as of Phase 5 completion — see §Revision history at the bottom.

## Goals

1. **Default-safe:** the bash implementation remains authoritative until the
   user explicitly opts into TS hooks.
2. **Reversible in one command:** any failure in the TS path is rolled back by
   `bun src/setup.ts --rollback` (or `bash setup.sh --rollback`), no manual
   `settings.json` surgery.
3. **No live toggling:** the flag is read at install time and written into
   `settings.json` hook commands. Switching requires re-install. This keeps
   the active configuration fully inspectable via `cat ~/.claude/settings.json`.

## The flag

Single env var, evaluated by `src/setup.ts` when writing `settings.json`:

```
CC_USE_TS_HOOKS   unset|0|false  →  hooks invoke scripts/*.sh  (default)
CC_USE_TS_HOOKS   1|true         →  hooks invoke bun src/hooks/*.ts
```

Equivalently, the CLI flag `--ts-hooks` can be passed directly:

```bash
# Opt into TS hooks
CC_USE_TS_HOOKS=1 bash setup.sh
# or
bun src/setup.ts --ts-hooks

# Revert to bash (same as default)
bash setup.sh
```

The chosen mode is persisted to `~/.claude/.cc-settings-version` alongside the
installer version. `setup.sh` / `bun src/setup.ts` without the flag preserves
whatever was last installed.

## How the rewrite works

`src/setup.ts` contains two maps (see `HOOK_REWRITE` and `INLINE_REWRITE`):

1. **Path rewrites.** `bash "$HOME/.claude/scripts/X.sh"` →
   `bun "$HOME/.claude/src/{hooks,scripts}/X.ts"` for every script we've
   ported. Covers: `safety-net`, `statusline`, `pre-edit-validate`,
   `skill-activation`, `post-edit`, `post-edit-tsc`, `post-compact`,
   `post-failure`, `stop-failure`, `session-start`, `log-bash`, `track-tldr`,
   `tldr-stats`, `notify`, `check-docs-before-install`, `handoff`.
2. **Inline marker rewrites.** `bash -c '…'` bodies are matched by a
   distinctive substring (e.g. `"Correction detected"`, `"[Swarm] Agent"`)
   and replaced with `bun "$HOME/.claude/src/scripts/<extracted>.ts"`.
   Covers: `detect-correction`, `pre-commit-tsc`, `stop-summary`, `swarm-log`
   (with `start|stop|task` argv).

Unmapped `bash` invocations are left untouched. The parity tests in
`tests/setup-rewrite.test.ts` assert that **no** `bash -c …` hook survives
when `--ts-hooks` is in effect — if someone adds a new inline hook without a
TS counterpart, CI fails.

## Shadow mode (opt-in, not wired by default)

`scripts/safety-net-shadow.sh` exists in the repo but is **not wired** into
`settings.json`. It runs both impls and logs divergences to
`~/.claude/safety-net-divergence.log`, preserving the bash exit code as
authoritative.

Rationale for skipping the live window: the 141-case parity battery
(`tests/safety-net.test.ts` shelling out to `.sh`, 69 cases, plus
`tests/safety-net-ts.test.ts` on the TS port, 72 cases, plus 3 protocol
contract tests) already asserts bash ↔ TS equivalence. Running both impls on
every live Bash call adds ~20ms per command for a week to confirm what tests
already confirm. Rollback via `--rollback` is the production safety net.

If you want shadow mode (e.g. for a future higher-risk port), wire the
wrapper manually by editing the PreToolUse Bash entry in `settings.json`:

```json
"command": "bash \"$HOME/.claude/scripts/safety-net-shadow.sh\""
```

## Settings.json shape under each mode

Bash mode (default):

```json
"PreToolUse": [
  { "matcher": "Bash", "hooks": [{ "type": "command",
     "command": "bash \"$HOME/.claude/scripts/safety-net.sh\"" }] }
]
```

TS mode (after `--ts-hooks`):

```json
"PreToolUse": [
  { "matcher": "Bash", "hooks": [{ "type": "command",
     "command": "bun \"$HOME/.claude/src/hooks/safety-net.ts\"" }] }
]
```

`bun` is resolved via `PATH`. `setup.sh` / `setup.ps1` aborts with a readable
error if Bun is not installed and can't be installed automatically.

## Rollback path

Two levels, cheapest first:

1. **Re-install in bash mode.** Always available, ~2 seconds.
   ```bash
   bash setup.sh                      # reinstalls; CC_USE_TS_HOOKS unset → bash
   ```

2. **Restore the last backup.** Every install tars `settings.json`,
   `CLAUDE.md`, and `AGENTS.md` to `~/.claude/backups/backup-<timestamp>.tar.gz`.
   Rollback restores the newest archive:
   ```bash
   bun src/setup.ts --rollback                       # newest
   bun src/setup.ts --rollback=2026-04-20T10-00-00Z  # specific
   # or equivalently:
   bash setup.sh --rollback
   ```

The bash scripts themselves are never deleted until Phase 7. Until then a
rollback to bash only requires `settings.json` to point back at them — the
files are always on disk.

## What this flag does **not** cover

- Stateful scripts invoked by skills (`handoff`, `checkpoint`, `learning`).
  These don't run via hooks, so the flag doesn't gate them. Both `.sh` and
  `.ts` ports exist during the migration window; skills pick whichever
  platform they prefer.
- The bootstrap (`setup.sh` / `setup.ps1`). These stay tiny (~70 lines each)
  and exist only to install Bun + exec the TS installer.
- CI. CI always runs the TS side — bash regressions are caught by
  `tests/safety-net.test.ts` (which shells out to `scripts/safety-net.sh`)
  and `tests/safety-net-ts.test.ts` (which runs the TS port). Both must pass.

## Open items surfaced by Phase -1 (kept for reference)

- **`bun build --compile` is not worth it on macOS.** Prototype result
  (`bench/prototype/result.json`): compiled binary cold-start p50 is
  essentially identical to `bun run` cold-start p50 (~19ms), while the binary
  weighs **~55 MB**. The TS hooks ship uncompiled; if a specific hook later
  proves too slow, revisit then.
- **Baseline shows two bash hooks already over budget**
  (`bench/baseline-bash.json`): `safety-net` analyze path ~131ms p95
  (budget 50ms), `statusline` ~104ms p95 (budget 100ms). The TS ports target
  ~20ms cold-start — so the cutover is a perf win, not just a parity ship.

## Exit criteria

Migration is "done" when:

- `find scripts/ -name '*.sh' | wc -l` → 0 (only `setup.sh` at repo root).
- `lib/` is gone.
- Every green gate passes on every PR (typecheck + test + lint + schemas-emit-clean + upstream-scan + bench-regression).
- `settings.json` references `./schemas/settings.schema.json` via `$schema`
  (done in Phase 1; IDE autocomplete active).
- `upstream-sync` bot has merged at least one manifest update without manual
  intervention.

## Revision history

- **2026-04-20 Phase -1/0/1:** contract drafted.
- **2026-04-20 Phase 5:** CC_USE_TS_HOOKS flag implemented in `src/setup.ts`
  with `HOOK_REWRITE` + `INLINE_REWRITE` maps and parity tests
  (`tests/setup-rewrite.test.ts`). Shadow-mode window explicitly skipped
  per solo-project risk assessment — rollback is the safety net.
  `setup.sh` reduced from 424 → 68 lines; `setup.ps1` added.
  `bun src/setup.ts` is now the authoritative installer.

This document is frozen. Future semantic changes require a new migration doc.
