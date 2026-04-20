# Migration Coexistence — `CC_USE_TS_HOOKS=1`

> Contract for running the bash and TypeScript hook implementations side-by-side
> during the Phase 1–6 migration. Source: `~/Desktop/cc-settings-MIGRATION.md` v2.

## Goals

1. **Default-safe:** the bash implementation remains authoritative until a TS
   hook has proven parity over an observation window.
2. **Reversible in one command:** any failure in the TS path is rolled back by
   a single `setup.sh --rollback`, no manual `settings.json` surgery.
3. **No live toggling:** the flag is read at install time and written into
   `settings.json` hook commands. Switching requires re-install. This keeps
   the active configuration fully inspectable via `cat ~/.claude/settings.json`.

## The flag

Single env var, evaluated by `src/setup.ts` when writing `settings.json`:

```
CC_USE_TS_HOOKS   unset|0|false  →  hooks invoke scripts/*.sh  (default)
CC_USE_TS_HOOKS   1|true         →  hooks invoke bun src/hooks/*.ts
```

Install:

```bash
# Opt into TS hooks
CC_USE_TS_HOOKS=1 bash setup.sh

# Revert to bash (same as default)
CC_USE_TS_HOOKS=0 bash setup.sh
```

The value is persisted to `~/.claude/cc-settings.state.json` (written by
`src/setup.ts`). `setup.sh` without the env var preserves whatever was last
installed — it does **not** silently reset to bash on every run.

## Shadow mode (safety-net only)

`safety-net` is the only hook with security consequences on divergence. For
Phase 4 it ships as a wrapper that runs both implementations and compares:

```
scripts/safety-net-shadow.sh:
  1. run scripts/safety-net.sh  → capture exit, stdout
  2. run bun src/hooks/safety-net.ts (background, separate env) → capture exit, stdout
  3. if exit codes differ OR stdout JSON differs:
        append JSON record to ~/.claude/safety-net-divergence.log
        (never fail the hook because of this — bash decision is authoritative)
  4. exit with the bash exit code, print the bash stdout
```

Cutover criterion: **7 consecutive days with zero divergences in the
divergence log** and all `tests/safety-net.test.ts` cases green. Until then
the shadow wrapper stays. Once cutover, `settings.json` points directly at
the `.ts` file and the wrapper is removed.

Divergence log schema (one JSON object per line):

```json
{
  "timestamp": "2026-04-27T12:34:56Z",
  "command": "<redacted>",
  "bash": { "exit": 2, "stdout": "{\"decision\":\"block\",\"reason\":\"...\"}" },
  "ts":   { "exit": 0, "stdout": "" }
}
```

Secrets redaction reuses `redact_secrets` from `scripts/safety-net.sh`.
Shadow mode is **not** applied to non-security hooks — `post-edit`,
`statusline`, etc. cut over directly once `bun test` + bench pass.

## Settings.json shape under each mode

Bash mode (default today, Phase 0–5):

```json
"PreToolUse": [
  { "matcher": "Bash", "hooks": [{ "type": "command",
     "command": "bash $HOME/.claude/scripts/safety-net.sh" }] }
]
```

TS mode (Phase 6+):

```json
"PreToolUse": [
  { "matcher": "Bash", "hooks": [{ "type": "command",
     "command": "bun $HOME/.claude/src/hooks/safety-net.ts" }] }
]
```

`bun` is an absolute-path–free invocation because `setup.sh` adds
`$HOME/.bun/bin` to `PATH` via Bun's installer. If `bun` is not on `PATH`,
`setup.sh` aborts with a readable error before touching `settings.json` —
the install never completes in a half-migrated state.

## Rollback path

Two levels, cheapest first:

1. **Re-install in bash mode.** Always available; 2 seconds.
   ```bash
   CC_USE_TS_HOOKS=0 bash setup.sh
   ```

2. **Restore the last backup.** `src/setup.ts` writes a timestamped copy of
   the previous `settings.json` to `~/.claude/backups/settings-<iso>.json`
   before every install. `setup.sh --rollback` restores the newest backup
   and exits without re-running the installer:
   ```bash
   bash setup.sh --rollback          # restores newest backup
   bash setup.sh --rollback=2026-04-20T10-00-00Z   # specific backup
   ```

The bash scripts themselves are never deleted until Phase 7. Until then a
rollback to bash only requires `settings.json` to point back at them — the
files are always on disk.

## What this flag does **not** cover

- Stateful scripts invoked by skills (`handoff`, `checkpoint`, `learning`).
  These don't run via hooks, so the flag doesn't gate them. Skills that
  shell out to them will use whichever file exists; during Phase 4 both
  `.sh` and `.ts` will exist and skills resolve the TS version first via
  `src/lib/resolve-script.ts`.
- `setup.sh` itself. Bootstrap stays bash (Phase 5 trims it to ~20 lines
  that `exec bun src/setup.ts`). Windows gets `setup.ps1`.
- CI. CI always runs the TS side — bash regressions are caught by
  `tests/safety-net.test.ts` shelling out to `scripts/safety-net.sh` as
  today's harness does.

## Open items surfaced by Phase -1

- **`bun build --compile` may not be worth it.** Prototype result
  (`bench/prototype/result.json`): compiled binary cold-start p50 is
  essentially identical to `bun run` cold-start p50 (~19ms), while the
  binary weighs **~55 MB**. Both comfortably beat the 50ms hot-path budget.
  Recommendation for Phase 4: default to `bun run src/hooks/*.ts` and only
  compile if a specific hook proves slower than budget. Revisit the
  `cc-hook` bundled-binary decision in the Phase 4 planning doc.
- **Baseline shows two bash hooks already over budget**
  (`bench/baseline-bash.json`): `safety-net` analyze path ~131ms p95
  (budget 50ms), `statusline` ~104ms p95 (budget 100ms). The TS port's
  bar is "ship parity faster than bash", which Phase -1 prototype numbers
  (~19ms cold-start) suggest is easily met. Good news for the cutover
  decision — the TS path is already the better path on perf.

## Exit criteria for this contract

This document is frozen once `src/setup.ts` lands in Phase 5. After that,
changes to the flag's semantics require a new migration doc, not edits to
this one.
