# Changelog

All notable changes to cc-settings are documented here.

> **Versioning** — cc-settings uses a single version number matching the installer (`src/setup.ts` `VERSION` constant, written to `~/.claude/.cc-settings-version` sentinel). Historical entries below 10.0 predate this unification; the jump from v8.x to v10.x in April 2026 realigned the product version with the installer version that was already ahead.

## [10.10.2] — 2026-05-04

### chore: self-/consolidate audit logged

Ran `/consolidate` on cc-settings' own surface (42 skills + 10 agents + 11 rules + 5 profiles). The methodology in `skills/consolidate/SKILL.md` was applied to the repo itself: trigger overlap audit, rule contradiction audit, discoverability check.

**Decision: no merges, no retirements this cycle.** The 9 intent clusters identified all sit at distinct specificity levels. The v10.4.0 stack-aware refactor already restructured the rules with explicit foundation/extension cross-references; further splitting would dilute, merging would create unwieldy multi-purpose files.

Full audit findings + trigger criteria for the next cycle are in `docs/consolidation-audits/2026-05.md`. Audit recommended at Q3 2026, or when surface counts cross documented thresholds (skills >50, rules LOC >2500), or on overlap signals.

**Files changed:**

- `docs/consolidation-audits/2026-05.md` — new audit log (first in series).
- `src/setup.ts` — `VERSION` 10.10.1 → 10.10.2.

## [10.10.1] — 2026-05-04

### docs: explicit Bun requirement; Node fallback dropped from the plan

A probe of the proposed Node 22 LTS fallback (P2.C of the cc-settings improvement plan) revealed the codebase is more deeply Bun-coupled than initial scoping suggested: `Bun.spawn`, `Bun.which`, `Bun.file`, `import.meta.dir` are used across 30+ files including every hook script. Porting via a runtime-abstraction layer is realistic but multi-day work — out of scope for Phase 2's "quick wins + medium refactors" frame.

**Decision: drop the Node fallback.** Bun is required, period. MANUAL.md's Quickstart now states this explicitly so users on locked-down environments learn the requirement upfront instead of mid-bootstrap.

The `setup.sh` bootstrap still auto-installs Bun via `curl -fsSL https://bun.sh/install | bash` for users with curl access. Corporate sandboxes that block curl-installs need a manual Bun install first.

Future-leaning: if a Node fallback is ever needed, the right path is a `src/lib/runtime.ts` abstraction layer that wraps `Bun.spawn`/`Bun.which`/etc. with Node-compatible fallbacks, then a pre-built `dist/` shipped with the repo. That's a P3+ project, tracked separately if/when a use case emerges.

**Files changed:**

- `MANUAL.md` — explicit "Requires Bun ≥ 1.1.30" callout in the Quickstart.
- `src/setup.ts` — `VERSION` 10.10.0 → 10.10.1.

## [10.10.0] — 2026-05-04

### test: E2E install + golden migration fixtures

Two new test layers cover ground that unit tests couldn't:

**Golden migration fixtures (`tests/fixtures/migrations/<scenario>/`).** Each scenario ships three files: `team-settings.json` (what cc-settings ships), `user-settings.json` (what the user has), `expected.json` (post-merge state). The runner deep-equals merger output against expected, with a sandboxed copy so fixtures stay immutable. Three scenarios committed:

| Scenario | What it locks in |
|---|---|
| `pre-v10-bash-hooks` | v10.3.2 hook prune: stale `bash $HOME/.claude/scripts/*.sh` references in user settings get dropped, team's `bun .../src/scripts/*.ts` survives |
| `pre-v10-bash-statusline` | v10.4.1 statusLine reset: stale `bash $HOME/.claude/scripts/statusline.sh` gets replaced with team's `bun .../src/hooks/statusline.ts` |
| `user-customizations-preserved` | Custom env vars + custom permission rules + custom Notification hook all survive a merge that simultaneously prunes a stale Stop hook |

These exercise the same ground as the unit tests (`tests/phase3-libs.test.ts`) but as snapshots — a refactor that accidentally drops a key or reorders output now fails with a deep-diff, not a missing assertion.

**E2E install test (`tests/install-e2e.test.ts`).** Spawns `bun src/setup.ts --source=<repo>` with `HOME` pointed at a fresh tmpdir + `CC_SKIP_DEPS=1`. Asserts the resulting `~/.claude/` tree shape: every managed directory exists, `settings.json` is valid JSON with the expected `$schema` and `statusLine.command`, the version sentinel was written, the first-install delta line printed. Three tests:

| Test | Coverage |
|---|---|
| First install on fresh HOME | full install path: backup → directories → cleanOldConfig → installConfigFiles → installTsSources → settings merge → sentinel → summary |
| Second install (re-run) | re-install path with existing sentinel; summary still prints |
| `--migrate-only` flag | merger + sentinel only; CLAUDE.md should NOT be copied |

**`CC_SKIP_DEPS=1` env var.** New escape hatch in `installDependencies`. Prevents the installer from running `npm i -g pinchtab`, `pipx install llm-tldr`, etc. — those write outside HOME and would pollute the dev/CI environment. Used by the E2E test; users won't typically need it.

**Files changed:**

- `tests/fixtures/migrations/{pre-v10-bash-hooks,pre-v10-bash-statusline,user-customizations-preserved}/{team,user,expected}-settings.json` — 9 fixture files.
- `tests/golden-migrations.test.ts` — fixture runner (4 tests).
- `tests/install-e2e.test.ts` — E2E install runner (3 tests).
- `src/setup.ts` — `CC_SKIP_DEPS` guard in `installDependencies`.
- `src/setup.ts` — `VERSION` 10.9.0 → 10.10.0.

## [10.9.0] — 2026-05-04

### refactor: strategy-based merge tree (internal-only)

Replaced the hand-coded `mergeSettingsWithMcpPreservation` with a strategy table. Each top-level field in `settings.json` registers a `Strategy` function in `STRATEGIES`; the orchestrator walks every key in (team ∪ user), picks the strategy (defaulting to user-wins-scalar), and assembles the result. Adding a new field-specific behavior is now one registry entry instead of a new helper + a new branch in the main function + a new accounting field — see for example the v10.4.1 statusLine fix, which previously required wedging a post-merge step into the orchestrator.

**Behavior preserved end-to-end** — all 236 existing tests pass without modification:
- permissions: deep object with array unions + scalar conflicts (deny is always additive)
- hooks: per-event group union with deprecated-script prune
- env: shallow merge, user wins on conflict
- statusLine: user wins, except when command targets a removed cc-settings script
- mcpServers: interactive preservation prompt (still handled before the per-key loop because the prompt is shared across the whole merge, not scoped to one strategy)
- unknown keys: fall through to user-wins-scalar (with prompts in interactive mode)

**New regression test** locks in the fallback for unknown top-level keys — a future Claude Code key cc-settings doesn't know about will round-trip through the merger without being dropped.

**Internal data layout:**

```ts
interface StrategyContext {
  opts: MergeOptions;
  accounting: MergeAccounting;  // strategies write counts here; orchestrator reads at the end
}

type StrategyResult = { keep: false } | { keep: true; value: unknown };
type Strategy = (team: unknown, user: unknown, ctx: StrategyContext) => Promise<StrategyResult>;

const STRATEGIES: Record<string, Strategy> = {
  permissions: permissionsStrategy,
  hooks: hooksStrategy,
  env: envStrategy,
  statusLine: statusLineStrategy,
};
```

mcpServers is still handled outside the table because its preservation prompt fires once for the whole merge, not per-key.

**Files changed:**

- `src/lib/mcp.ts` — strategy interface + 4 strategy functions + `userWinsScalarStrategy` fallback + new orchestrator. Net: replaces ~250 LOC of hand-coded helpers + special-cases with ~330 LOC of structured strategies. Slightly longer but every field's logic is in one place and the orchestrator is a single loop.
- `tests/phase3-libs.test.ts` — added regression test for unknown-key fallback.
- `src/setup.ts` — `VERSION` 10.8.0 → 10.9.0.

## [10.8.0] — 2026-05-04

### feat: --migrate-only flag

Re-running `bash setup.sh` does the full install: dependency check, file copy, MANAGED_SKILLS refresh, settings merger. For users who hit a deprecation message ("Reset stale statusLine command…", "Pruned N stale hook reference(s)…") and want to clean up their settings without the rest, that's overkill.

`--migrate-only` runs just the merger + version sentinel + version delta + prereq check. Skipped:

- `installDependencies` (bun, jq, pinchtab, tldr — assumed present)
- `cleanOldConfig` (no need to wipe managed content)
- `installConfigFiles` (no skill / agent / docs refresh)
- `installTsSources` (no `src/` recopy)
- `showSummary` (the visual recap is meant for full installs)

Backup still runs. `createDirectories` still runs (idempotent — ensures `~/.claude/` shape exists for the merger).

```bash
bash setup.sh --migrate-only
```

**Files changed:**

- `src/setup.ts` — `Args.migrateOnly`, `parseArgs` exports + handles `--migrate-only`, `main()` branches on it.
- `tests/setup-args.test.ts` — new file. 10 parser tests covering every flag (`--rollback`, `--rollback=<ts>`, `--dry-run`, `--status`, `--interactive`, `--migrate-only`, `--source=<path>`, `--help`/`-h`, multi-flag composition, defaults).
- `MANUAL.md` — Quickstart mentions `--migrate-only`.
- `src/setup.ts` — `VERSION` 10.7.1 → 10.8.0.

## [10.7.1] — 2026-05-04

### fix: composeSettings asserts unique numeric prefixes

`composeSettings` previously sorted `config/*.json` fragments alphabetically. With 4 fragments today (`10-core`, `20-mcp`, `30-permissions`, `40-hooks`) that worked, but it would silently miscompose if someone added `010-foo.json` (which alphabetizes before `10-core.json`) or `100-extra.json` (which alphabetizes between `10-` and `20-`). Both edge cases produced ambiguous merge order with no error.

The composer now:

1. **Sorts by numeric prefix value** — `10-*` comes before `100-*` (was reversed under alpha sort).
2. **Rejects fragments without a numeric prefix** — `extra.json` throws at install with a clear message.
3. **Rejects collisions on numeric value** — `10-foo.json` and `010-bar.json` (both 10) both throw, naming the conflict.

The naming contract `<digits>-<name>.json` is now formally enforced.

**Files changed:**

- `src/lib/compose-settings.ts` — prefix extraction + uniqueness check + numeric sort.
- `tests/compose-settings.test.ts` — 11 tests: repo dogfood, naming contract failures, ordering correctness, content errors, empty/missing dir.
- `src/setup.ts` — `VERSION` 10.7.0 → 10.7.1.

## [10.7.0] — 2026-05-04

### feat: agent + skill frontmatter validation at install

Typos like `effort: xtreme` or `permissionMode: planning` used to silently degrade agents — the field would be ignored and the agent would run with defaults. The installer now parses every `agents/*.md` and `skills/*/SKILL.md` frontmatter against a zod schema and warns about issues before shipping the file to `~/.claude/`.

**New schema** — `src/schemas/agent.ts`:

| Field | Type | Notes |
|---|---|---|
| `name` | kebab-case string | required |
| `description` | non-empty string | required |
| `model` | `opus` / `sonnet` / `haiku` / pinned variant | accepts `opus[1m]`-style strings |
| `effort` | `low` / `medium` / `high` / `xhigh` / `max` | strict — typos rejected |
| `permissionMode` | `default` / `acceptEdits` / `plan` / `auto` / `dontAsk` / `bypassPermissions` | mirrors upstream manifest |
| `isolation` | `worktree` | strict |
| `memory` | `project` | strict |
| `tools`, `disallowedTools` | string arrays | passthrough |
| `maxTurns` | positive integer | |
| `color`, `initialPrompt`, `hooks`, `mcpServers` | accepted, lightly typed | |

The schema is `.passthrough()` on unknown fields — agent ecosystem is fast-moving and we'd rather accept than reject. Strict enums on the well-known fields are where the value is.

**New validator** — `src/lib/frontmatter-validate.ts`:

Walks `agents/*.md` and `skills/*/SKILL.md`, parses each frontmatter, validates against the corresponding schema, returns the combined issue list. Wired into `setup.ts`'s install flow — non-fatal warning so a single bad agent doesn't block install of the rest.

**JSON schema published** — `schemas/agent.schema.json` joins the others at `raw.githubusercontent.com/darkroomengineering/cc-settings/main/schemas/`. IDEs that point at it get autocomplete on `effort`, `permissionMode`, etc. when authoring agents.

**Files changed:**

- `src/schemas/agent.ts` — new zod schema.
- `src/schemas/emit.ts` — added agent.schema.json target.
- `src/lib/frontmatter-validate.ts` — install-time validator.
- `src/setup.ts` — calls validator before install, warns via `warn()` if any issues.
- `tests/agent-schema.test.ts` — 16 tests: schema unit tests, repo dogfood (all 10 agents + 42 skills validate today), synthetic failure cases (effort typo, permissionMode typo, kebab violation, missing delimiters, empty dirs).
- `schemas/agent.schema.json` — emitted.
- `src/setup.ts` — `VERSION` 10.6.1 → 10.7.0.

## [10.6.1] — 2026-05-04

### fix: hook fail-open audit — wrap 7 unhardened scripts

A hook crash is supposed to be invisible to the parent operation. Audit revealed 7 of 25 hook scripts could throw uncaught (rest already had `try {` or `.catch(`):

| Script | Hook event | What could throw |
|---|---|---|
| `notify.ts` | Notification | `await notifyWindows()` if PowerShell crashed |
| `cwd-changed.ts` | CwdChanged | `projectAwareness()` (git read failure, missing files) |
| `session-title.ts` | UserPromptSubmit | `mkdir`/`writeFile` on permissions or disk full |
| `check-docs-before-install.ts` | PreToolUse:Bash | regex/string ops (defensive — low actual risk) |
| `post-edit-tsc.ts` | PostToolUse | `Bun.spawn` if `bunx` missing |
| `pre-commit-tsc.ts` | PreToolUse:Bash (`git commit`) | spawn / Promise.all crash |
| `stop-summary.ts` | Stop | `git diff --stat` outside a repo or git missing |

Each now wraps its body in `try { … } catch { /* silent */ }`, matching the pattern already used by `safety-net.ts` (the highest-criticality hook).

**`pre-commit-tsc.ts` keeps its blocking semantics:** genuine `error TS<N>` from tsc still exits 1 to block the commit. Only *infrastructure* crashes (bunx missing, spawn failure) fail open. The commit guard rail is preserved.

**Skipped:**

- `swarm-log.ts` already uses `.catch(() => {})` on every IO call — defensive enough.
- `claude-audit.ts` is a manual CLI invoked by `/audit`, not a hook; errors there should be visible to the user.

**Regression test:** `tests/hook-fail-open.test.ts` walks every TS script wired in `config/40-hooks.json` and asserts each contains either `try {` or `.catch(`. Future hooks can't ship without fail-open handling.

**Files changed:**

- `src/scripts/{notify,cwd-changed,session-title,check-docs-before-install,post-edit-tsc,pre-commit-tsc,stop-summary}.ts` — wrapped in try/catch.
- `tests/hook-fail-open.test.ts` — new regression test.
- `src/setup.ts` — `VERSION` 10.6.0 → 10.6.1.

## [10.6.0] — 2026-05-04

### feat: skills declare `requires:` (CLI / MCP); installer warns about missing prereqs

Skills with external dependencies now declare them in their frontmatter:

```yaml
---
name: lighthouse
description: …
requires:
  - command: lighthouse
    install: "npm i -g lighthouse"
---
```

The installer walks every skill at the end of `setup.sh`, evaluates each `requires:` against the user's environment (CLIs via `Bun.which`, MCP servers via the union of `~/.claude/settings.json` and `~/.claude.json`), and prints a single warning block listing any missing prereqs. Non-fatal — the skill still runs; users just know in advance which ones will fail until they install the prereq.

**Annotated this release:**

| Skill | Requires |
|---|---|
| `/lighthouse` | `lighthouse` CLI |
| `/figma` | `pinchtab` CLI + `figma` MCP |
| `/qa` | `pinchtab` CLI |
| `/debug` | `pinchtab` CLI |
| `/tldr` | `tldr` MCP (`pipx install llm-tldr`) |
| `/docs` | `context7` MCP (ships by default) |

**Schema change:** `src/schemas/skill.ts` now exports `SkillRequirement` (discriminated union of `{ command }` or `{ mcp }`, both with optional `install` hint). `SkillFrontmatter.requires` is optional; existing skills without it continue to work unchanged. Each entry must declare exactly one of `command` or `mcp`.

**Files changed:**

- `src/schemas/skill.ts` — new `SkillRequirement` schema; `requires` field added to `SkillFrontmatter`.
- `src/lib/skill-prereqs.ts` — new helper: parse skills, read MCP servers from settings.json + ~/.claude.json, evaluate requires, format warning block.
- `src/setup.ts` — calls `reportMissingPrereqs` after `showSummary`, warns via `warn()` if any prereq is missing.
- `tests/skill-prereqs.test.ts` — 20 tests: schema validation, MCP server reading (with malformed-JSON tolerance), CLI/MCP requirement checks, end-to-end report aggregation, formatter cases.
- `skills/{lighthouse,figma,qa,debug,tldr,docs}/SKILL.md` — annotated with `requires:`.
- `schemas/skill.schema.json` — regenerated (now describes `SkillRequirement`).
- `src/setup.ts` — `VERSION` 10.5.2 → 10.6.0.

## [10.5.2] — 2026-05-04

### feat: install-summary version delta

Re-running `bash setup.sh` now ends with a one-block summary of what landed since the previous install:

```
cc-settings: v10.4.1 → v10.5.2 (3 version(s) since last install)
  • v10.5.2: install-summary version delta
  • v10.5.1: docs: MANUAL.md Day-1 Quickstart
  • v10.5.0: IDE IntelliSense — published JSON schemas at GitHub raw
```

Reads the version sentinel (`~/.claude/.cc-settings-version`) BEFORE the install overwrites it, parses `## [X.Y.Z] — DATE` + `### <title>` headings out of `CHANGELOG.md`, and renders the delta. First installs print `cc-settings: first install at v<X>`. Re-installs of the same version print nothing. Downgrades (rollback scenarios) are flagged.

The merger's existing migration messages (hook prune, statusLine reset) still print separately — those tell you what the merger *did*, while the delta tells you which *versions* you got.

**Files changed:**

- `src/lib/version-delta.ts` — new helper. Pure parsing/formatting + sentinel read.
- `src/setup.ts` — captures `prevInstalledVersion` before `writeVersionSentinel`, prints delta after `showSummary`.
- `tests/version-delta.test.ts` — 23 tests covering compareVersion, sentinel parsing, CHANGELOG parsing, between-filtering, format cases (first install / same / downgrade / forward / missing CHANGELOG), and a roundtrip against the repo's real CHANGELOG.
- `src/setup.ts` — `VERSION` 10.5.1 → 10.5.2.

## [10.5.1] — 2026-05-04

### docs: MANUAL.md Day-1 Quickstart

Replaced the install-only "Quick Start" header with a true Day-1 Quickstart: install → `/init` (asks satus vs novus) → "describe what you want" golden-path table → "ask Claude what skill handles X" escape hatch. Closes the orientation gap a fresh joiner felt — they now have a 5-minute path from install to productive work without scrolling the 500-line reference.

The "Daily Workflows" section still exists as the next layer of depth. Existing skill / agent / hook tables unchanged.

**Files changed:**

- `MANUAL.md` — replaced lines 6-23 with a 5-step Quickstart.
- `src/setup.ts` — `VERSION` 10.5.0 → 10.5.1.

## [10.5.0] — 2026-05-04

### IDE IntelliSense — published JSON schemas at GitHub raw

The `schemas/*.schema.json` files (already generated from `src/schemas/*.ts` via `bun run schemas:emit`) now carry real `$id` URLs at `raw.githubusercontent.com/darkroomengineering/cc-settings/main/schemas/`. VSCode, Cursor, JetBrains, and any JSON-Schema-aware editor will autocomplete every cc-settings field, validate values, and surface inline docs.

The composed team `settings.json` (via `config/10-core.json`) now references our schema instead of `json.schemastore.org/claude-code-settings.json`. Users who author `~/.claude/settings.json` by hand can add `"$schema": "..."` at the top to opt in.

**Files changed:**

- `src/schemas/emit.ts` — `$id` URLs now point at GitHub raw on main; placeholder `cc-settings.darkroom/schema/...` URLs replaced.
- `schemas/{settings,hooks-config,skill,claude-json}.schema.json` — regenerated.
- `config/10-core.json` — `$schema` points at our published schema.
- `package.json` — new `schemas:check` script (regen + assert no diff; CI guard against zod-source changes that forget to re-emit).
- `tests/schemas.test.ts` — coverage for $id URLs, title metadata, config $schema reference, roundtrip composed-settings validation.
- `docs/settings-reference.md` — "IDE IntelliSense" section explains the published URLs.
- `src/setup.ts` — `VERSION` 10.4.1 → 10.5.0.

## [10.4.1] — 2026-05-04

### Fix: statusline missing for pre-v10 upgraders

Some users were seeing no statusline at all after upgrading. Root cause: pre-v10 cc-settings shipped `statusLine` as `bash "$HOME/.claude/scripts/statusline.sh"`. The bash → TS migration in v10.0.0 deleted that directory and rewrote the team value to `bun "$HOME/.claude/src/hooks/statusline.ts"` — but the merger does `{ ...teamRaw, ...userRaw }` for top-level objects, so any user with the old value carried it forward. Claude Code tries to spawn the missing script, gets a non-zero exit, and renders no bar.

The hooks-array prune from v10.3.2 didn't cover this case because `statusLine` is a single top-level object, not an array entry.

**Fix:** the merger now also detects when `userRaw.statusLine.command` matches `DEPRECATED_COMMAND_PATTERNS` and resets to the team value. Custom user statuslines pointing at non-deprecated paths (e.g. their own script) are left alone.

**Existing affected users:** re-run `bash setup.sh`. The summary line `Reset stale statusLine command…` confirms cleanup.

The `DEPRECATED_HOOK_COMMAND_PATTERNS` constant from v10.3.2 was renamed to `DEPRECATED_COMMAND_PATTERNS` since it now applies to both hook entries and the top-level statusLine.

**Files changed:**

- `src/setup.ts` — `VERSION` 10.4.0 → 10.4.1.
- `src/lib/mcp.ts` — generalize the deprecation registry; reset stale statusLine post-merge.
- `tests/phase3-libs.test.ts` — coverage for stale-statusLine reset + non-deprecated-statusLine preservation.

## [10.4.0] — 2026-05-04

### Stack-aware ergonomics — Next.js (satus) + React Router (novus)

Darkroom is splitting between two starters — `satus` (Next.js) and `novus` (React Router 7) — and cc-settings now mirrors that. Rules describe stack-agnostic principles followed by clearly-labeled Next.js + React Router subsections. Scaffolding skills detect the project's stack from `package.json` and emit the right shape.

**New:**

- `profiles/react-router.md` — full RR7 profile mirroring `profiles/nextjs.md`: route module exports, loaders, actions, `defer()`, novus-specific path alias / asset pipeline notes.
- `src/lib/stack.ts` — detector returning `{ kind, starter, alsoDetected, evidence, cwd }`. Detects nextjs, react-router, vite-react, react-native, tauri, unknown. Reads `package.json` deps + config files + folder shape (in that order). Recognizes satus and novus starters from name lineage or explicit `darkroom.starter` marker.
- `tests/stack.test.ts` — 23 tests covering each detection path, multi-stack projects, starter detection, malformed input.

**Refactored rules:**

- `rules/web-vitals.md`, `rules/react-perf.md`, `rules/performance.md`, `rules/react.md` rewritten to lead with stack-agnostic principles + Next.js/RR subsections. The model picks the right pattern from visible imports — no detector layer in rules.

**Refactored scaffolding skills (read package.json, branch on stack):**

- `/component` — paths, image/link wrappers, `'use client'` directive, path alias all branch.
- `/hook` — `lib/hooks/` (satus) vs `hooks/` (novus); directive presence; browser-API guards.
- `/init` — picks satus or novus, asks if user is unsure.
- `/build` — research gate detects stack; primitives table covers both.
- `/lenis` — mount point differs (`app/layout.tsx` vs `app/root.tsx`).

**Refactored agents:**

- `agents/scaffolder.md` — templates per stack for component/hook/page/server-endpoint. RR resource routes + actions added.
- `agents/reviewer.md` — checklist now stack-aware (RR component is isomorphic; satus uses `'use client'` boundary).

**Statusline fix:**

- Effort+thinking marker `⚙xhigh†` was reading as `xhight†` in monospace terminal fonts where the dagger glyph has a t-like ascender. Replaced `†` → `+` (`⚙xhigh+` is unambiguous in any font). `src/hooks/statusline.ts:114`.

**Docs:**

- `MANUAL.md` adds the `react-router` profile row and a "Stack-aware skills" section pointing at the detector.

**Files changed:**

- `src/setup.ts` — `VERSION` 10.3.2 → 10.4.0.
- `src/lib/stack.ts` — new detector.
- `src/hooks/statusline.ts` — dagger → plus.
- `tests/stack.test.ts` — new test file (23 tests).
- `profiles/react-router.md` — new profile.
- `rules/web-vitals.md`, `rules/react-perf.md`, `rules/performance.md`, `rules/react.md` — stack-aware rewrite.
- `skills/component/SKILL.md`, `skills/hook/SKILL.md`, `skills/init/SKILL.md`, `skills/build/SKILL.md`, `skills/lenis/SKILL.md` — stack detection + dual templates.
- `skills/docs/SKILL.md`, `skills/lighthouse/SKILL.md`, `skills/prd/SKILL.md` — minor stack-aware references.
- `agents/scaffolder.md`, `agents/reviewer.md` — stack-aware checklists/templates.
- `MANUAL.md` — react-router profile row + stack-aware skills section.

**Why minor (10.4.0) not patch:** new feature surface (RR profile, stack detector, dual templates) + behavior change in scaffolding skills. No breaking changes — projects with no detectable stack get the same default behavior as before (satus assumptions).

## [10.3.2] — 2026-05-04

### Fix: prune stale hook references to removed `~/.claude/scripts/*.sh`

Re-run `bash setup.sh` if you're seeing `bash: ~/.claude/scripts/<name>.sh: No such file or directory` on every session — the merger now scrubs those leftover refs from your `settings.json`. The summary line `Pruned N stale hook reference(s)…` confirms cleanup.

The bash → TypeScript migration in v10.0.0 deleted `~/.claude/scripts/`, but the per-event hook union in `mergeHooks` preserved any user-side reference that didn't byte-match a current team entry. New `DEPRECATED_HOOK_COMMAND_PATTERNS` in `src/lib/mcp.ts` is the registry for future removals — see the comment block above the constant.

User memory is never touched by install: `~/.claude/memory/`, `~/.claude/memory/agents/`, and per-project `~/.claude/projects/<slug>/memory/` are only `mkdir`-ensured. `autoMemoryDirectory` survives the merger's user-wins scalar pass.

### v2.1.126 Sync — Manifest-only bump

v2.1.124–2.1.126 were patch fixes only. No new schema keys, hooks, env vars, or frontmatter — nothing to absorb.

**Notable upstream fixes that benefit cc-settings automatically:**

- Deferred tools (`WebSearch`, `WebFetch`, …) now reach `context: fork` skills on first turn (18+ cc-settings skills).
- Stream idle timeout no longer aborts on Mac sleep / long Opus thinking pauses.
- OAuth login handles IPv6 devcontainers, slow connections, and manual code paste.
- `Ctrl+L` redraws instead of clearing the prompt.

**Files changed:**

- `src/setup.ts` — `VERSION` 10.3.1 → 10.3.2.
- `src/lib/mcp.ts` — `DEPRECATED_HOOK_COMMAND_PATTERNS` + prune logic in `mergeHooks`.
- `tests/phase3-libs.test.ts` — stale-hook prune coverage.
- `upstream/claude-code-manifest.json` — 2.1.123 → 2.1.126.

## [10.3.1] — 2026-04-30

### v2.1.123 Sync — Adopt `ANTHROPIC_BEDROCK_SERVICE_TIER`, `spinnerTipsOverride`

Reviewed cc-settings against Claude Code changelog v2.1.121 → v2.1.123. Quiet cycle: v2.1.123 was fix-only, and v2.1.122 was mostly bug fixes plus two additive surface changes. No native overlap to remove.

**Adopted:**

- **`ANTHROPIC_BEDROCK_SERVICE_TIER` env var** (v2.1.122) — accepts `default`, `flex`, or `priority`; sent as the `X-Amzn-Bedrock-Service-Tier` header so Bedrock callers can pick a service tier without a custom proxy. Added to `upstream/claude-code-manifest.json` `knownEnvVars` and the env-var table in `docs/settings-reference.md`.
- **`spinnerTipsOverride` setting** (v2.1.122) — upstream fixed `spinnerTipsOverride.excludeDefault` not suppressing time-based spinner tips, which means the key is real and our `.strict()` schema would reject it. Added `SpinnerTipsOverride` (passthrough, only `excludeDefault: boolean` documented upstream) to `src/schemas/settings.ts`, and a section to `docs/settings-reference.md`. Added to manifest `knownSettingsKeys`.
- **Manifest bump** — `upstream/claude-code-manifest.json`: `2.1.121` → `2.1.123`, refreshed `lastScan` to `2026-04-30`.

**Files changed:**

- `src/setup.ts` — `VERSION` 10.3.0 → 10.3.1.
- `src/schemas/settings.ts` — `SpinnerTipsOverride` schema + `spinnerTipsOverride` field.
- `upstream/claude-code-manifest.json` — version bump, `ANTHROPIC_BEDROCK_SERVICE_TIER`, `spinnerTipsOverride` keys.
- `docs/settings-reference.md` — env-var table row + `spinnerTipsOverride` section.

**Native-now-redundant:** none this cycle.

**Skipped (bug fixes, no surface change):** OAuth 401 retry loop with `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`, `/branch` rewound-timeline forks, `/model` Effort for Bedrock ARNs, Vertex/Bedrock structured-output `output_config` errors, Vertex `count_tokens` proxy 400s, ToolSearch missing late-attached MCP tools in nonblocking mode, `!exit`/`!quit` exiting CLI from bash mode, image resize 2576px → 2000px, remote-control idle redraw flooding `tmux -CC`, stale view preference blanking messages, malformed hooks no longer invalidating settings.json, OTel numeric attribute serialization, OTel `claude_code.at_mention` log event, Caps Lock voice keybinding error, `/resume` PR-URL paste, `/mcp` clarifications.

## [10.3.0] — 2026-04-28

### v2.1.121 Sync — Adopt `alwaysLoad`, `mcp_tool` hooks, statusline effort, agent `permissionMode`

Reviewed cc-settings against Claude Code changelog v2.1.115 → v2.1.121. No native overlap to remove this cycle (the v10.1.0 sweep already cleared the big duplications). Adopted seven new upstream features.

**Adopted:**

- **MCP `alwaysLoad: true`** (v2.1.121) — `config/20-mcp.json` opts `context7` out of `ENABLE_TOOL_SEARCH` deferral. Docs lookup is hot-path; the deferral round-trip was paid on every `/docs`-style prompt. Schema: `src/schemas/mcp.ts` shared `mcpCommon` block on both `McpStdioServer` and `McpHttpServer`.
- **`type: "mcp_tool"` hooks** (v2.1.118) — added `McpToolHook` to the `Hook` discriminated union in `src/schemas/hooks.ts` (fields: `server`, `tool`, optional `input` with `${path}` substitution). Settings validation now accepts the new hook type without complaint when users wire it up.
- **`prUrlTemplate` setting** (v2.1.119) — added to `Settings` schema; documented in `docs/settings-reference.md`. Lets teams point the footer PR badge at internal review tools instead of github.com.
- **Statusline effort + thinking display** (v2.1.119) — `src/hooks/statusline.ts` now reads `effort.level` and `thinking.enabled` from stdin and renders them as a dimmed marker on the model name (`Opus 4.7 ⚙xhigh†`). The `†` indicates thinking enabled.
- **Agent `permissionMode: plan`** (v2.1.119) — added to all four read-only agents (`explore`, `oracle`, `reviewer`, `security-reviewer`). When the user runs `claude --agent reviewer` or similar, Claude Code now honors this mode automatically.
- **New env vars in manifest + docs** — `CLAUDE_CODE_HIDE_CWD` (v2.1.119), `DISABLE_UPDATES` (v2.1.118), `CLAUDE_CODE_FORK_SUBAGENT` (v2.1.117/121), `AI_AGENT` (v2.1.120), `CLAUDE_EFFORT` (v2.1.120, skill-only), `OTEL_LOG_USER_PROMPTS` (v2.1.121).
- **Manifest bump** — `upstream/claude-code-manifest.json`: `2.1.114` → `2.1.121`, added `prUrlTemplate` to `knownSettingsKeys`, `mcp_tool` to `knownHookTypes`, refreshed `lastScan`.

**Files changed:**

- `src/setup.ts` — `VERSION` 10.2.1 → 10.3.0.
- `upstream/claude-code-manifest.json` — version bump + key additions above.
- `src/schemas/settings.ts` — `prUrlTemplate` field.
- `src/schemas/hooks.ts` — `McpToolHook` + 5-arm discriminated union.
- `src/schemas/mcp.ts` — shared `mcpCommon` block adds `alwaysLoad`.
- `config/20-mcp.json` — `context7.alwaysLoad = true`.
- `src/hooks/statusline.ts` — effort/thinking marker on model name.
- `agents/{explore,oracle,reviewer,security-reviewer}.md` — `permissionMode: plan`.
- `CLAUDE-FULL.md` — agent frontmatter table (added `permissionMode`, `mcpServers` rows).
- `docs/settings-reference.md` — env-var table, `prUrlTemplate`, MCP fields table, context7 example.

**Native-now-redundant:** none this cycle. Closest call was `ENABLE_TOOL_SEARCH=auto:50` vs per-server `alwaysLoad`, but the env var still controls the global default — they're complementary, not redundant.

## [10.2.1] — 2026-04-24

### Fix: stdio MCP servers launch via `bunx` instead of `npx`

`context7` and `chrome-devtools` failed to start from any project whose root `package.json` combined Bun's `catalog:` protocol with `overrides` (npm aborts with `EOVERRIDE: Override for elysia@catalog: conflicts with direct dependency`). Because `npx` resolves from the current working directory, the failure surfaced whenever Claude Code was launched inside such a monorepo — `/mcp` reported `Failed to reconnect to context7` / `chrome-devtools` even though auth and network were fine.

Swapped `"command": "npx"` → `"command": "bunx"` for all stdio servers. Bun understands `catalog:` natively, and cc-settings already mandates `bun >=1.1.30` (see `package.json` `engines`), so the dependency is guaranteed.

**Changes:**

- `config/20-mcp.json` — `context7`, `chrome-devtools` now launch via `bunx`.
- `mcp-configs/recommended.json` — `context7`, `chrome-devtools` (installed) and `github`, `memory` (optional) updated for consistency.
- `mcp-configs/README.md` — examples updated, added a note explaining the `bunx` choice.
- `docs/settings-reference.md` — `context7` example updated with a monorepo note.

**Existing installs:** re-running `setup.sh` does *not* overwrite MCP servers already in `~/.claude.json` (user entries shadow the team baseline — see `src/lib/mcp.ts:481`). To migrate an existing install:

```bash
claude mcp remove context7 -s user
claude mcp remove chrome-devtools -s user
bash ~/Developer/@darkroom/cc-settings/setup.sh
```

## [10.2.0] — 2026-04-22

### Non-destructive settings.json merge + `--interactive` installer

Re-running the installer no longer overwrites hand-edits to `~/.claude/settings.json`. Root cause was `{ ...teamRaw, mcpServers: ... }` in `mergeSettingsWithMcpPreservation` wholesale-replacing every top-level key; only `mcpServers` had preservation logic. Users reported losing hand-added Bash permissions (the trigger for this work).

**New merge policy (non-interactive, default):**

- `permissions.{allow,deny,ask,additionalDirectories}` → union; team baseline stays as the floor, user additions preserved. `deny` is always additive (safety guardrail).
- `permissions.defaultMode` / `autoMode` → user wins when declared.
- `hooks` → per-event union of groups, dedupe by structural equality.
- `env` → shallow merge, user values win on conflict (local overrides like `ENABLE_PROMPT_CACHING_1H` stick).
- Top-level scalars (`model`, `statusLine`, `theme`, …) → user wins when declared.
- `mcpServers` → unchanged (interactive prompt).

Installer logs a one-line summary of preserved customizations, e.g. `✓ Preserved user customization: 3 permission rule(s), 1 env override(s)`.

**New `--interactive` flag:**

`bash setup.sh --interactive` (or `CC_INTERACTIVE=1`) prompts on each real conflict point:

- Scalar conflicts (top-level, `permissions.defaultMode`/`autoMode`, `env.*`) → "keep your value / take team's".
- Team additions to `permissions.allow` / `ask` / `additionalDirectories` and new hook groups → "adopt / skip".
- `permissions.deny` additions and user-only entries never prompt.

Defaults on every prompt reproduce the non-interactive output, so `--interactive` is a safe way to audit the merge before committing.

**Changes:**

- `src/lib/mcp.ts` — rewrote `mergeSettingsWithMcpPreservation`; added `MergeOptions`, field-aware merge helpers (`unionPermissionArray`, `mergePermissions`, `mergeHooks`, `mergeEnv`, `resolveTopLevelScalars`, `resolveScalarConflict`).
- `src/setup.ts` — added `--interactive` flag (and `CC_INTERACTIVE=1` env); threaded through to `installSettings`.
- `setup.sh` / `setup.ps1` — documented `--interactive` in flag headers (bootstrap already forwards all args).
- `tests/phase3-libs.test.ts` — 7 new tests: permission union, team-deny re-appearance, hook union, env user-wins, top-level scalar user-wins, interactive-with-defaults parity, interactive-deny-always-applies.
- `README.md` / `MANUAL.md` — install sections mention non-destructive behavior + `--interactive`.
- `docs/settings-reference.md` — new "Re-install Merge Behavior" section documenting both modes.

## [10.1.0] — 2026-04-21

### v2.1.116 Sync — Duplication Cleanup + New Feature Adoption

Reviewed cc-settings against Claude Code changelog v2.1.0 → v2.1.116 (2026-04-21). Removed duplication with native features, adopted new capabilities.

**Deletions (~550 lines removed):**

- **`src/hooks/skill-activation.ts`** (107 lines) — Native `Skill` tool (v2.1.108) auto-matches skills from `description` frontmatter. Custom pattern-matching hook no longer needed.
- **`src/scripts/compile-skills.ts`** (144 lines) — Only consumed by deleted `skill-activation.ts`. Along with the `~/.claude/skill-index.compiled` side-file.
- **`src/lib/skill-patterns.ts`** (hot-path Record lookup) — Only used by deleted scripts. Also removed its test block in `tests/phase3-libs.test.ts` and export from `src/lib/index.ts`.
- **`src/scripts/detect-correction.ts`** — 10-line trigger-word regex over UserPromptSubmit. Low signal; users can invoke `/learn` themselves.
- **`skills/versions/`** — Subset of `/docs` + the existing `check-docs-before-install.ts` PreToolUse hook. `MANAGED_SKILLS` keeps `versions` for one release to clean up stale installs.
- **`compile-skills` invocation in `src/scripts/session-start.ts`** and **`compileSkillIndex()` in `src/setup.ts`** — dead after the above.

**Adopted (new Claude Code features):**

- **Session auto-titling via `hookSpecificOutput.sessionTitle`** (v2.1.94) — new `src/scripts/session-title.ts` UserPromptSubmit hook derives 3-5 word kebab-case title from the first prompt. Makes `claude --resume <name>` usable (v2.1.101).
- **Agent `disallowedTools` frontmatter** (v2.1.84) — added permission-rule-syntax blocklists to every agent:
  - Read-only agents (`explore`, `oracle`, `reviewer`, `security-reviewer`): block `Bash(git commit:*)`, `Bash(git push:*)`, `Bash(rm:*)`, `Bash(gh pr:*)` (plus `Bash(curl:*)` for security-reviewer).
  - Writing agents (`implementer`, `scaffolder`, `tester`, `deslopper`, `maestro`): block `Bash(git push:*)`, `Bash(rm:*)` — git push and file deletion must be user-initiated.
- **Agent `maxTurns` frontmatter** (v2.1.84) — `explore: 30`, `oracle: 25`, `reviewer: 30`, `security-reviewer: 30`. Caps read-only agents from runaway loops.
- **`sandbox` block in `settings.json`** (v2.1.113) — `failIfUnavailable: false` by default; docs explain how to flip on once sandbox availability is confirmed per platform.
- **`CLAUDE_CODE_SCRIPT_CAPS=500`** (v2.1.98) — bounds per-session hook-script invocations. Cheap insurance given ~14 configured hooks.

**Documentation swept:**

- `CLAUDE-FULL.md` — new sections for session auto-titling and agent frontmatter table.
- `docs/hooks-reference.md` — UserPromptSubmit table reflects `session-title.ts` only; removed stale `skill-activation.out` log reference and its debug snippet.
- `docs/settings-reference.md` — added `CLAUDE_CODE_SCRIPT_CAPS`, `ENABLE_PROMPT_CACHING_1H`, `CLAUDE_CODE_NO_FLICKER` env vars; expanded `sandbox` field reference.
- `docs/migration-coexistence.md` — Phase 4 note updated to reflect later deletion of `skill-activation` / `compile-skills`.
- `MANUAL.md` — merged the `/versions` entry into the `/docs` section.
- `skills/README.md` — removed `versions` row from Tools table.
- `hooks/README.md` — retabled configured hooks (UserPromptSubmit now a single entry), `.sh → .ts` script names aligned with reality post-TS-migration.
- `agents/deslopper.md` — Bash/Markdown cross-index example now points at `MANAGED_SKILLS` array instead of deleted `skill-patterns.sh`.

**Opportunities flagged, not adopted:**

- `CwdChanged` / `FileChanged` hooks (v2.1.83) — reactive env management; no concrete use case yet.
- `Elicitation` / `ElicitationResult` hooks (v2.1.76) — could intercept Sanity/Figma OAuth prompts; deferred.
- OTEL env vars (`OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_RAW_API_BODIES`) — could replace `log-bash.ts` + `swarm-log.ts` at team scale; deferred until collector exists.
- `/ultrareview` (v2.1.111) — native parallel multi-agent review; our `/review` is a thin agent wrapper with different surface area, kept for now.
- `/less-permission-prompts` (v2.1.111) — run it once against the current 60+ entry allow list to consolidate; owner to schedule.

### Audio Removal + Pre-TS-Migration Deslop

- **Removed `scripts/notify-sound.sh`** (146 lines) and all 8 hook invocations — audio feedback unused in practice.
- **Removed `PermissionDenied` hook event entirely** — its only action was `notify-sound.sh safety_block`.
- **Removed `PostToolUse if: Bash(git commit*)` hook** — was commit sound only.
- **Simplified PreToolUse `safety-net.sh` wrapper** — dropped the sound-on-block branch; direct script invocation now.
- **Dropped `Bash(afplay:*)` from `.claude/settings.local.json`**.
- **Pruned `hooks-config.json`** — removed `audio.*` (14 lines) and stale `compact_reminder` (3 lines) sections.
- **Removed dead `is_hook_enabled` function** from `lib/hook-config.sh` (no callers).
- **Stopped sourcing `lib/hook-config.sh` in `setup.sh`** — it's runtime-only (used by `session-start.sh`).
- **Doc sync**: corrected hook-event count (23/26 → 27) across `README.md`, `hooks/README.md`, `docs/hooks-reference.md`; added missing `PostCompact`, `StopFailure`, `TaskCreated` rows.

### New MCP Servers

- **Figma Dev Mode MCP** — Remote HTTP at `https://mcp.figma.com/mcp`. OAuth on first use. Design-to-code: tokens, styles, component props, variables.
- **Chrome DevTools MCP** — Stdio via `chrome-devtools-mcp@latest`. Performance traces, network, console, user simulation. Preferred over `lighthouse` CLI for Core Web Vitals.

### Duplication & Native-Replacement Cleanup

- **`model: "opus[1m]"` → `"opus"`** — 1M context is default on Max plans (v2.1.75+).
- **Removed `Bash(cat|head|tail|less|sed -n):*`** from `permissions.allow` — CLAUDE.md instructs Claude to use Read/Edit tools.
- **Simplified `PermissionDenied` hook** — dropped bespoke logging (native `/less-permission-prompts` in v2.1.111 covers it).
- **Simplified `Stop` hook** — dropped `compact-reminder.sh` call (native `/context` tips in v2.1.108 cover it).
- **Removed `skills/effort/`** — superseded by native `/effort` interactive slider (v2.1.111).
- **Removed `scripts/permission-denied.sh`, `scripts/compact-reminder.sh`** — no longer referenced.

### Docs

- **New `docs/cache-strategy.md`** — KV-cache prefix ordering and wake-up budget guidance moved out of CLAUDE-FULL.md.
- **`CLAUDE-FULL.md` 182 → 161 lines** — Cache-Friendly Context Ordering and Hook Events sections replaced with pointers.
- **Stale references swept** — MANUAL.md, USAGE.md, hooks-reference, frontmatter-reference, hooks/README, skills/README, skill-patterns.sh, skill-activation.sh, setup.sh.

### Model Update: Opus 4.7

- Updated all model references from Opus 4.6 / Sonnet 4.6 to Opus 4.7 / Sonnet 4.7
- Updated across: CLAUDE-FULL.md, settings-reference, MANUAL, USAGE, plugin.json, skills, rules, tests

### New Features Adopted (Claude Code v2.1.108–v2.1.110)

- **`ENABLE_PROMPT_CACHING_1H`** — Enabled 1-hour prompt cache TTL in settings.json env block. Extends KV-cache reuse from 5 minutes to 1 hour (API key, Bedrock, Vertex, Foundry).
- **`/tui fullscreen`** — Documented flicker-free fullscreen rendering mode (pairs with existing `CLAUDE_CODE_NO_FLICKER=1` env var).
- **`/focus`** — Documented transcript toggle (normal vs verbose view).
- **`/recap`** — Documented session recap feature; auto-triggers on session return.
- **Output token limits** — Documented 64K default / 128K upper bound for Opus/Sonnet.
- **`PermissionDenied` hook** — Added to Hook Events listing in CLAUDE-FULL.md (27 events, up from 26). Already configured in settings.json since v7.x.
- **Hooks reference update** — Added `PermissionDenied` event to docs/hooks-reference.md with env vars (`$TOOL_NAME`, `$PERMISSION_DECISION_REASON`) and configured hook entry.

### Files Changed

- `CLAUDE-FULL.md` — Model version, session commands, output limits, cache env var, hook count
- `settings.json` — Added `ENABLE_PROMPT_CACHING_1H` env var
- `rules/git.md` — Updated attribution example
- `docs/settings-reference.md` — Updated model table
- `docs/hooks-reference.md` — Added PermissionDenied event, env vars, configured hook section
- `.claude-plugin/plugin.json` — Updated keyword
- `MANUAL.md` — Updated statusline example
- `USAGE.md` — Updated statusline example
- `skills/context/SKILL.md` — Updated statusline and degradation table
- `tests/safety-net-test.sh` — Updated test fixture

---

## Previous Versions

Pre-unification milestones (product versioned as v5–v8; installer versioned 8–10 separately):

- **v8.0.0** — 1M context window default via `opus[1m]` model alias
- **v7.x** — Hook system expansion (27 events), PermissionDenied hook, conditional `if` field
- **v6.x** — Agent Teams, TLDR integration, skill system
- **v5.x** — Portable AGENTS.md, two-tier knowledge system
