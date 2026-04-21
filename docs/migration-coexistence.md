# Migration Coexistence — archived

> **Status: complete.** Phase 7 landed on 2026-04-20. The cc-settings repo
> is fully TypeScript; the bash scripts and libs it previously shipped are
> gone. This document remains as a record of how the migration worked.

## What was migrated

21 bash scripts (~3.3k lines) + 7 bash libs (~1.4k lines), all inline
`bash -c '…'` hooks, plus the 424-line `setup.sh` installer. Target
runtime: Bun (uncompiled TypeScript; compile prototyping in Phase -1
proved `bun build --compile` offered no startup win on macOS vs `bun run`).

## What stayed bash

- `setup.sh` (68 lines) and `setup.ps1` (72 lines) — bootstraps that ensure
  Bun is installed and exec `bun src/setup.ts`. No install logic.

## Shape of the migration

1. **Phase -1 — groundwork** (`bench/baseline-bash.json`, port of test
   harness to bun:test, compile prototype, this coexistence doc).
2. **Phase 0 — scaffolding** (`package.json`, `tsconfig.json`, `biome.json`,
   `.gitattributes`, CI matrix).
3. **Phase 1 — schemas** (zod schemas for `settings.json`, hooks,
   permissions, MCP, skill frontmatter, hooks-config, `~/.claude.json`).
   Emit committed JSON Schema referenced from `settings.json` via `$schema`.
   Upstream-sync scanner first-snapshot at Claude Code 2.1.114.
4. **Phase 2 — leaf scripts** (12 scripts ported to `src/scripts/`).
5. **Phase 3 — shared libs** (7 libs ported to `src/lib/`).
6. **Phase 4 — hot-path hooks + stateful** (`safety-net`, `statusline`,
   `pre-edit-validate` + `handoff`, `checkpoint`, `learning`, `project-init`).
   `hooks-config.json` collapsed into `settings.json.env` as `CC_CLAUDE_MD_*`.
   Later removed: `skill-activation`, `compile-skills` (native `Skill` tool
   in Claude Code v2.1.108 supersedes pattern-matching approach).
7. **Phase 5 — installer** (`src/setup.ts` full port, `setup.sh` shrunk to
   bootstrap, `setup.ps1` added, bench regression gate in CI).
8. **Phase 6 — cutover** (rewrote repo `settings.json` to invoke
   `bun src/{hooks,scripts}/*.ts` directly; six inline `bash -c '…'`
   blocks extracted to dedicated TS scripts).
9. **Phase 7 — deletion** (deleted `scripts/*.sh`, `lib/*.sh`,
   `hooks-config.json`, shadow wrapper, legacy bash test harness;
   simplified installer; dropped `CC_USE_TS_HOOKS` flag and the rewriter;
   Windows CI `test` job re-enabled).

## Shadow mode — explicitly skipped

The plan called for a 7-day shadow observation window on `safety-net` (both
bash and TS running on every Bash call, divergences logged). We skipped it
on solo-project risk assessment: 141 parity test cases
(`tests/safety-net.test.ts` after rename was 72 TS cases; pre-Phase-7
`tests/safety-net-test.sh` had 69 bash cases) already asserted equivalence.
Rollback (`bun src/setup.ts --rollback`) was the production safety net.

The wrapper (`scripts/safety-net-shadow.sh`) was deleted along with the rest
of the bash in Phase 7. If a future risky port wants shadow mode again, the
pattern is in git history (commit `00e1ae6`).

## Rollback (still works)

```bash
bun src/setup.ts --rollback                       # newest backup
bun src/setup.ts --rollback=2026-04-20T10-00-00Z  # specific
bash setup.sh --rollback                          # equivalent
```

Every install tars `settings.json`, `CLAUDE.md`, `AGENTS.md` into
`~/.claude/backups/backup-<timestamp>.tar.gz` (keeps the 5 most recent).

## Commits

```
725f4f7 feat(ts): Phase 5 full — TS installer, tiny bootstraps, extracted hooks
5847548 feat(ts): Phase 5 groundwork — --rollback + TS source install
a38ce29 feat(ts): Phase 4.2–4.11 — stateful + hot-path TS ports
00e1ae6 feat(ts): Phase 4.1 — safety-net.ts + shadow wrapper
2e75680 feat(ts): Phase 3 — port all 7 shared libs to TypeScript
34e9286 feat(ts): Phase 2 — port all 12 leaf scripts to TypeScript
7658067 feat: Phase -1/0/1 baseline — bench, scaffolding, zod schemas
```

(+ a Phase 6+7 commit — same one that introduced this revision of the doc.)
