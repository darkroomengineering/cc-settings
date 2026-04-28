# Changelog

All notable changes to cc-settings are documented here.

> **Versioning** — cc-settings uses a single version number matching the installer (`src/setup.ts` `VERSION` constant, written to `~/.claude/.cc-settings-version` sentinel). Historical entries below 10.0 predate this unification; the jump from v8.x to v10.x in April 2026 realigned the product version with the installer version that was already ahead.

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
