# Changelog

All notable changes to cc-settings are documented here.

> **Versioning** — cc-settings uses a single version number matching the installer (`src/setup.ts` `VERSION` constant, written to `~/.claude/.cc-settings-version` sentinel). Historical entries below 10.0 predate this unification; the jump from v8.x to v10.x in April 2026 realigned the product version with the installer version that was already ahead.

## [Unreleased]

## [11.12.1] — 2026-06-02

Upstream sync to Claude Code v2.1.160 — a cleanup-only release. v2.1.160 is almost entirely platform/feature bug fixes (Windows/WSL, background sessions, vim/voice/IME, `claude agents`) that cc-settings never worked around, plus native security hardening with no config surface. The one actionable change is a removed env var. Typecheck + full suite green; scanner reports no drift.

### Synced (Claude Code v2.1.159 → v2.1.160)

- **Removed `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE` (v2.1.160)** — upstream deleted this env var (pinned fast mode to Opus 4.6; already flagged "two generations stale" since Opus 4.8). Dropped from `upstream/claude-code-manifest.json` `knownEnvVars` and the `docs/settings-reference.md` env table so the scanner stops vouching for a var that no longer exists. Historical `CHANGELOG.md` mentions are left intact as a record.
- **Already aligned** — the v2.1.160 rename of the dynamic-workflow trigger keyword from `workflow` to `ultracode` needs no change: cc-settings adopted `ultracode` everywhere in 11.x (2.1.154+) and carried no stale `workflow`-keyword references.
- **Manifest** — `claudeCodeVersion` 2.1.159 → 2.1.160, `lastScan` refreshed. Scanner reports no drift.
- **Skipped** — native hardening with no cc-settings surface (prompt before writing shell startup files / `~/.config/git/`; `acceptEdits` prompts before build-tool configs; Edit-after-grep no longer needs Read); removed JetBrains plugin suggestion; and the v2.1.160 bug-fix batch (WSL clipboard, `claude agents` history/freeze, `claude --bg` socket, Windows dir-deletion/keys/links, CJK IME, voice non-ASCII, vim `p`, SDK `--model` hint, brief-mode resume, `/effort ultracode` workflow-blame, auto-mode latency, SIGTERM teardown).

### Files changed

- `upstream/claude-code-manifest.json`
- `docs/settings-reference.md`
- `src/setup.ts`
- `CHANGELOG.md`

## [11.12.0] — 2026-06-01

Structural cleanup from a `/nuclear-review` whole-codebase audit (2026-05-29), plus a suite of orchestration-tax features built from the audit and the "Orchestration Tax" essay (review-queue backpressure, proof-of-work gate, and more below), released together with an upstream sync to Claude Code v2.1.159. The cleanup is behavior-preserving (internal export renames aside); the new hooks/skills are additive. Full suite green, typecheck + lint clean.

### Added

- **Review-queue backpressure** — `src/lib/review-queue.ts` + `src/hooks/review-queue-nudge.ts` (PostToolUse) count agents spawned since your last commit and nudge when the queue reaches `CC_MAX_UNREVIEWED` (default `5`); a `git commit` drains it. The statusline shows `⚠ N review (age)` — yellow under the threshold, red at/over — and a fast commit of a deep queue is flagged as **cognitive surrender** (committed faster than `CC_MIN_REVIEW_SECONDS`, default `60`, plausibly allows for real review). The consumer-side counterpart to `parallelmax-nudge`, which now **suppresses its own "delegate more" nudge when the queue is saturated** so the two don't give opposing advice. Models the constraint the "Orchestration Tax" essay names: review throughput, not agent count. Knobs: `CC_MAX_UNREVIEWED`, `CC_MIN_REVIEW_SECONDS`.
- **Proof-of-work gate** — `bun run proof` (`src/lib/proof-of-work.ts`, `src/scripts/proof.ts`, `skills/proof-of-work/`) runs the verification battery (typecheck/test/lint, detected from `package.json`, cheapest-first) and prints one `review-ready ✓ / ✗` verdict. The Amdahl-shrink move: make the machine prove the boring 80% so human review spends the lock on judgment, not on confirming what a machine can. The `implementer` agent now attaches a proof report before handing back. Pairs with the review-queue — backpressure limits *unproven* diffs; the gate makes each cheaper to close.
- **Two-pile triage in orchestration** — `skills/orchestrate/SKILL.md` Phase 1 and `agents/maestro.md` now sort work before fanning out: *delegate-async* (isolated, judgment at the gate) fans out; *hold-the-lock* (judgment IS the work) stays serial — parallelizing the second pile thrashes the one resource that can't be cloned. A judgment-heavy task is a SIMPLIFY/NO-GO for orchestration regardless of size.
- **`/review-batch` + re-entry cards** — `skills/review-batch/` + `bun run review-batch` (`src/scripts/review-batch.ts`) assemble the pending-review picture (queue depth + age, working-tree diff stat, recent agents from `swarm.log`) so you batch-review in one sitting instead of cold-reloading one agent at a time. Each change gets a re-entry card (what / why / decide / proof) that reloads *your* context cheaply. Attacks the context-switch tax.
- **Opt-in nuclear-review workflow** — `skills/nuclear-review/references/nuclear-review.workflow.js`, a runnable dynamic-workflow version of the whole-codebase audit (map → per-module reviewers in parallel → dependency audit → synthesis). It deliberately uses the preview Workflow API, which is exactly why it ships as an *example* in `references/` rather than wired into the skill — `/nuclear-review` itself still depends on nothing. Softened the orchestrate rule from "don't couple to the Workflow tool" to "don't *depend* on it; an opt-in example is fine."

### Synced (Claude Code v2.1.156 → v2.1.159)

- **Adopted `CLAUDE_CODE_ENABLE_AUTO_MODE` (v2.1.158)** — opt-in (`=1`) for auto mode on Bedrock, Vertex, and Foundry for Opus 4.7/4.8 (native on the first-party API). Added to `upstream/claude-code-manifest.json` `knownEnvVars` (alphabetical) and the `docs/settings-reference.md` env table so the scanner stops re-flagging it as drift.
- **Docs refinements (v2.1.157)** — the `OTEL_LOG_TOOL_DETAILS` env row now notes it also adds `tool_parameters` to `tool_decision` telemetry events; the `agent` settings-key row notes it's now honored by `claude agents` dispatched sessions.
- **Manifest** — `claudeCodeVersion` 2.1.156 → 2.1.159, `lastScan` refreshed. Scanner reports no drift.
- **Skipped** — v2.1.159 internal-only changes; `.claude/skills` plugin auto-loading + `claude plugin init` (cc-settings installs skills directly, not via marketplace); `/plugin` autocomplete; `EnterWorktree` mid-session switching; worktree unlock-on-completion; and assorted image-paste / sandbox-prompt / `/model`-picker / terminal-UI bugfixes.

### Changed

- **`src/lib/json-io.ts` (new)** — extracted the generic JSON + atomic-file I/O (`atomicWriteString`, `atomicWriteJson`, `readJsonOrNull`) plus the parse-error class out of `src/lib/mcp.ts`, which had stranded these in a domain module that `setup.ts`, `settings-merge.ts`, `status.ts`, and `scripts/track-tldr.ts` all imported purely for I/O. `mcp.ts` is now MCP-only. The error class is renamed `McpParseError` → `JsonParseError` to match its new home (`setup.ts` + `tests/phase3-libs.test.ts` updated). No re-export shim left behind.
- **`src/lib/hooks-fingerprint.ts`** — `writeFingerprint` now calls the canonical `atomicWriteJson` instead of hand-rolling its own tmp-file + rename (byte-identical output).
- **`src/lib/project-awareness.ts`, `src/lib/status.ts`, `src/scripts/checkpoint.ts`, `src/scripts/stop-summary.ts`** — replaced private `run`/`runCapture` spawn-stdout copies and inline `git` spawns with the canonical `runGit` from `src/lib/git.ts`. Behavior-preserving: these git commands emit no stdout on failure, so `runGit`'s trimmed-stdout result matches the old exit-code-gated `""`.
- **Name collisions resolved** — `audit-hooks.ts`'s exported `classify`/`Severity` → `classifyHookCommand`/`HookSeverity`; `lint-skills.ts`'s `Severity` → `SkillSeverity`; `claude-audit.ts`'s private `classify` → `classifyBashCommand`. No two modules export the same identifier with different semantics anymore (`tests/audit-hooks.test.ts` updated).
- **`src/lib/hook-config.ts`** — converted `readFileSync` → async `readFile` through `getHookConfig`/`getClaudeMdMonitor`, removing the lone sync I/O in the otherwise-async SessionStart hook layer (`session-start.ts` now awaits). The env-var fast path still short-circuits before any file read.
- **`src/lib/settings-merge.ts`** — documented a removal policy for the append-only `DEPRECATED_COMMAND_PATTERNS` list (drop a pattern ~6 minor releases after its target script was removed) so it doesn't grow unbounded.
- **Dependencies** — bumped to latest and normalized to exact pins (dropped the two stray carets): `zod` 4.3.6→4.4.3, `@biomejs/biome` 2.4.12→2.4.16 (plus the `biome.json` `$schema` URL), `@types/bun` 1.3.12→1.3.14, `yaml` →2.9.0, `@inquirer/confirm` →6.1.0. All within the same major; generated schemas unchanged; 399 tests still pass.
- **`MANUAL.md`** — corrected the Effort Level section (listed `low/medium/high (default)`; the real pinned default is `xhigh`, the ladder also has `max`, plus the session-only `ultracode` mode) and added a "Model on AWS / Bedrock / Vertex / Foundry" note to pin `ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-8` — surfacing a footgun previously documented only in the changelog (`opus` silently resolves to 4.7 on AWS, 4.6 on Bedrock/Vertex/Foundry).

### Removed

- **`isStack()` (`src/lib/stack.ts`)** — dead export, zero references repo-wide.
- **`runGitFull` (`src/lib/git.ts`)** — the thin `runProcessFull("git", …)` wrapper is gone; its 8 callers in `checkpoint.ts` and `upstream/scan.ts` now call `runProcessFull("git", …)` directly. (Initially kept as a `runGit`/`runGitFull` pair; removed by maintainer decision — one fewer indirection, at the cost of more verbose call sites.)
- **Exports narrowed** — `FRONTMATTER_RE`, `FrontmatterParseError`, `FrontmatterParseResult` (`frontmatter.ts`) and `isInteractive` (`prompts.ts`) are no longer exported; each was used only within its own module. (Also initially left exported, then narrowed by maintainer decision.)

### Notes

- `tests/phase2-scripts.test.ts` (`prune-mcp-auth-cache`) now writes its fixture under `os.tmpdir()` with an `afterAll` cleanup, instead of leaving an untracked `.tmp-mcp-auth-cache-test/` at the repo root.

## [11.11.0] — 2026-05-29

Three ideas ported from Shopify Engineering's ["Under the River"](https://shopify.engineering/under-the-river) (May 2026), scoped to what actually maps onto a config repo (its monorepo/Nix/Postgres-session infrastructure does not). The post's load-bearing claim — *private agent sessions plateau; public corpora compound* — surfaced a real gap: `share-learning` was retired in `[11.3.0]`, leaving the shared knowledge board with no invocation UI and nothing to prompt its use, so every learning died in one developer's private auto-memory.

### Added

- **`skills/share-learning/` (revived, improved)** — restores the `/share-learning <type> "<text>"` UI for the shared GitHub Project knowledge board. Unlike the `[11.3.0]`-retired wrapper, it now **dedups against the board** (`gh project item-list` → semantic near-duplicate check → confirm with the user) before `gh project item-create`, so the value is agent judgment, not a thin CLI shim. Skill count 27 → 28 (under the 40 soft-cap).
- **`src/hooks/promote-memory.ts` (new `PostToolUse` hook)** — when a `project`- or `feedback`-type auto-memory is written, emits one gentle `additionalContext` nudge suggesting `/share-learning` if the learning is team-relevant. Deduped per memory file (seen-set under `~/.claude/.cache/`); silent for `user`/`reference` types and non-memory writes. Makes promotion proactive instead of relying on the developer to remember the board exists.
- **`src/schemas/profile.ts` (`ProfileFrontmatter`)** — profiles gain a validated frontmatter convention (`name`, `description`, advisory `model` / `skills` / `tools` / `permissionMode` / `effort`), reusing the agent schema's `AgentModel` / `AgentEffort` / `AgentPermissionMode` to prevent drift. **Advisory only** — validated for well-formedness and read as a manifest of intent, *not* runtime-enforced (whether Claude Code consumes profile frontmatter at runtime is intentionally not relied upon). Emits `schemas/profile.schema.json`.
- **`tests/profile-schema.test.ts`** — `ProfileFrontmatter` accept/reject cases plus a check that all six shipped profiles validate. Full suite 399 pass.

### Changed

- **`AGENTS.md`** — added a third `## Philosophy` principle: the work to make a codebase legible to an agent is the debt you owe your human engineers; every skill/rule/intent-doc entry pays it down for both audiences at once.
- **`profiles/*.md` (all 6)** — added the new frontmatter block. The five tech profiles (`nextjs`, `react-native`, `tauri`, `webgl`, `react-router`) previously had none; `maestro` gained advisory `model`/`skills`/`effort`.
- **`config/40-hooks.json`** — registered `promote-memory.ts` under `PostToolUse` (`Write|Edit`, sync, 3s timeout).
- **`src/lib/managed-skills.ts`** — moved `share-learning` from the upgrade-cleanup tombstones back into the active list.
- **`src/lib/frontmatter-validate.ts`** — `validateFrontmatters` now also walks `profiles/*.md` (new `kind: "profile"`, mirroring `validateAgents`); install warning wording → "agents/skills/profiles".
- **`docs/profiles.md` / `docs/frontmatter-reference.md`** — document the profile frontmatter convention and its advisory caveat.
- **Skill-count references** — `CLAUDE.md`, `CLAUDE-FULL.md`, `MANUAL.md`, `skills/README.md` updated 27 → 28 and de-listed `share-learning` from "retired".

### Notes

- The shared-board mechanism (`docs/knowledge-system.md`, env `KNOWLEDGE_PROJECT_NUMBER`) was unchanged; this batch only restores its UI and makes promotion proactive.
- Pre-existing `lint/style/useTemplate` info on `src/scripts/gen-permissions-doc.ts:65` is unrelated to this batch and was left untouched.

## [11.10.0] — 2026-05-28

Tracks Anthropic's Opus 4.8 release and surfaces Claude Code's new dynamic workflows / `ultracode` mode without coupling the orchestration layer to the (still preview-stage) `Workflow` tool API.

### Changed

- **`.claude-plugin/plugin.json`** — keyword `opus-4.7` → `opus-4.8`; `requires.claude_code` bumped `>=2.1.116` → `>=2.1.154` (minimum version for Opus 4.8 + dynamic workflows).
- **`CLAUDE-FULL.md`** — "Opus 4.7 note" → "Opus 4.8 note"; rewrote the effort calibration paragraph: default effort on 4.8 is `high` (was `xhigh` on 4.7); cc-settings still pins `xhigh` via `CLAUDE_CODE_EFFORT_LEVEL`, but the `xhigh` ladder allocates more thinking tokens per turn on 4.8, so the compact-at-65% rationale was updated accordingly. Added `ultracode` to the effort ladder as a session-only mode that combines `xhigh` reasoning with automatic workflow orchestration.
- **`AGENTS.md`** — response-calibration + literal-prompt notes updated 4.7 → 4.8.
- **`docs/settings-reference.md`** — model table now shows Opus 4.8 / Sonnet 4.6 with a provider-resolution callout for AWS / Bedrock / Vertex / Foundry; Bedrock ARN example updated to `claude-opus-4-8` / `claude-sonnet-4-6`; legacy `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE` flagged "two generations stale"; added a note clarifying that `ultracode` is session-only and **not** a valid value for `CLAUDE_CODE_EFFORT_LEVEL` / `effortLevel` / `--effort`.
- **`skills/orchestrate/SKILL.md`** — added "Alternative: dynamic workflows" callout pointing users at `/effort ultracode` and the `workflow` keyword for tasks matching the large-codebase-analysis / wide-blast-radius-migration shapes, while keeping maestro `Agent()` fan-out as the default.
- **`skills/nuclear-review/SKILL.md`** — added a tip in "When to use" pointing reviewers at `/effort ultracode` for whole-codebase audits; the workflow runtime holds phase state outside Claude's context window, freeing room for actual review findings.
- **`skills/handoff/SKILL.md`** — statusline example + degradation-threshold table updated to Opus 4.8 / Sonnet 4.6.
- **`MANUAL.md` / `USAGE.md`** — statusline screenshots updated.
- **`rules/git.md`** — co-author DON'T example updated.
- **`tests/safety-net.test.ts`** — co-author block-list test string updated (the rule still blocks any "Claude" co-author; the assertion string was 4.7-specific).
- **`src/hooks/parallelmax-nudge.ts` / `src/hooks/statusline.ts`** — copy / example-string comment updated.

### Notes

- No structural changes to `maestro`, `planner`, `implementer`, or `orchestrate`. The `Workflow` tool's API is research preview; coupling the cc-settings orchestration layer to it now would constrain us when it stabilizes. The default delegation path stays `Agent()` fan-out.
- Provider note: On the Anthropic API and claude.ai Max, the `opus` alias resolves to Opus 4.8 with no further config. On Claude Platform on AWS, `opus` still resolves to 4.7; on Bedrock / Vertex / Foundry it resolves to 4.6 — pin `claude-opus-4-8` via `ANTHROPIC_DEFAULT_OPUS_MODEL` on those providers.

## [11.9.1] — 2026-05-27

Delegation tuning in response to studio feedback that `implementer` spawned too eagerly and that worktree isolation hid its changes from pre-commit review. The write-agents now run in the live working tree and leave an uncommitted diff for review instead of working in an isolated `origin/main` checkout.

### Changed

- **`agents/{implementer,scaffolder,tester,deslopper}.md`** — removed the `isolation: worktree` default. These agents now run in the caller's live working tree, so edits land as a reviewable diff rather than commits on a hidden worktree branch. Each also blocks `Bash(git commit:*)` (tester already did) so work is left uncommitted for the caller to review before it lands. `reviewer` / `security-reviewer` keep worktree isolation — they produce reports, not diffs.
- **`agents/implementer.md`** — reframed the Briefing Gate and `REQUIRED BRIEFING` rationale off the worktree premise. The briefing contract still holds (a subagent receives only its prompt, with no conversation context), but the justification is context isolation, not a fresh checkout. The "commit logical chunks" workflow step and "report your commit SHA" verification line became "leave an uncommitted diff."
- **CLAUDE-FULL.md** — raised the `implementer` delegation threshold from "2+ files" to "3+ files, or 10+ tool calls"; widened "act directly" to cover 1–2 file / sub-10-tool-call edits; replaced the "Don't self-override" enforcement rule (which pushed the model to spawn even for small work) with "Match the tool to the size"; reframed the briefing-contract callout off worktree.
- **docs/feature-agents-guide.md** — updated the "base ref overwrites in-session edits" gotcha: the write-agents no longer default to worktree, so the footgun only applies when worktree isolation is explicitly opted into.

### Notes

- Behavior change: orchestrations that relied on `implementer` (or the other write-agents) committing their own chunks now receive an uncommitted diff; the dispatching session is responsible for committing after review.

## [11.9.0] — 2026-05-26

Whole-codebase maintainability pass from a `/nuclear-review` audit. Behavior-preserving across the board — full test suite (380) and typecheck stay green. No file exceeded 1000 lines and all six direct dependencies are within one minor of current with idiomatic usage (native `z.toJSONSchema`, no redundant deps), so this batch is structural cleanup only.

### Changed

- **`src/hooks/safety-net.ts`** — the four full-string rules (AI attribution, find/xargs, shell + interpreter unwrap) ran once on the whole command and again per split segment, doubling work on every single-segment command. Reframed into two tiers: `analyzeFullString` (rules that need the un-split command) runs once; `analyzeSegment` runs only rm/git, which must see each `;`/`&&`/`||` segment so a safe leading subcommand can't mask a destructive trailing one. `analyzeCommand` remains the depth-bounded recursion target.
- **`src/lib/git.ts`** — extracted `runProcessFull(bin, args)`; `runGitFull` delegates to it and `src/upstream/scan.ts`'s byte-identical local `runGh` is gone. `runGit` gains an optional `{ cwd }` so `src/hooks/statusline.ts` drops its copied spawn body (its local adapter now only binds `--no-optional-locks` + cwd).
- **`src/lib/platform.ts`** — added `ymd()` (YYYY-MM-DD); removed three private copies in `log-bash.ts`, `claude-audit.ts`, and `session-start.ts`.
- **`src/setup.ts`** — parallelized independent install I/O (`createDirectories`, the disjoint removals in `cleanOldConfig`, the lockfile copies, the two disjoint-tree install phases, and summary counts). Clean-then-install ordering preserved.
- **`src/scripts/handoff.ts`** — single-flag arg loop collapsed to a `findIndex`; the two `latest.*` symlink updates now run concurrently.
- **`src/hooks/pre-edit-validate.ts`** — reads `file_path` + `old_string` from the single `TOOL_INPUT` JSON blob, dropping the redundant per-field-env source asymmetry.
- **`src/lib/colors.ts`** — `showBanner` version param is now required (stale `"8.0"` default removed).

### Fixed

- **`src/lib/audit-hooks.ts`** — `totalHooks` now counts audited command hooks (the value the CLI prints as "hook command(s) total") instead of `findings.length`, which over-counted by the schema pseudo-finding whenever schema validation failed. `looksOpaque` uses `reduce` instead of `Math.max(...spread)` to avoid a call-stack blowout on pathological settings.json input.

### Notes

- The audit flagged the discarded `safeParse` result in `mergeSettingsWithMcpPreservation` (`settings-merge.ts`). Investigated and **intentionally left as-is**: the root `Settings` schema is `passthrough` but nested objects (`StatusLine`, `Attribution`, …) strip unknown keys, so merging validated `.data` would silently drop forward-compat fields. The raw-based merge is correct; the validation is a deliberate diagnostic.

## [11.8.3] — 2026-05-26

Audit-driven documentation fixes and a permission-listing generator that keeps the allow/deny rules exhaustive and self-syncing.

### Fixed

- **CLAUDE.md** dep name: `@inquirer/prompts` → `@inquirer/confirm` (matches package.json).
- **README.md** skill count: 26 → 27; agent count: 10 → 9; profiles listing: added `react-router` in two places.
- **MANUAL.md** stack-aware skills list: removed retired `/lenis`; removed `oracle` from the All Agents table (it is a skill, not an agent); hooks section header changed from "Hooks (Automatic — 29 Events)" to "Hooks (Automatic)" with a one-line lead pointing to `docs/hooks-reference.md`.
- **docs/settings-reference.md** context7 tool name: `mcp__context7__get-library-docs` → `mcp__context7__query-docs`; `modelOverrides` ARN version suffixes: `4-6` → `4-7`.
- **docs/hooks-reference.md** SessionStart table: added missing `verify-hooks.ts` row (fingerprint validation, sync, runs before `session-start.ts`).
- **hooks/README.md** hooks table: added missing `TaskCompleted` row (`swarm-log.ts complete`, async).
- **mcp-configs/README.md** key name: all three occurrences of `disabledMcpServers` → `disabledMcpjsonServers` (the correct key; the old name silently no-ops).
- **docs/frontmatter-reference.md** All Agents table: `explore`, `implementer`, `tester`, `scaffolder`, `deslopper` corrected to `sonnet` (were incorrectly listed as `opus`); `oracle` row removed (no `agents/oracle.md`); "Agents with memory enabled" note updated to remove `oracle`.

### Added

- **`src/scripts/gen-permissions-doc.ts`** — exports `buildPermissionsBlock(repoRoot)` and marker constants `BEGIN`/`END`; CLI (`bun run docs:permissions`) injects the generated allow/deny listing into the `<!-- BEGIN/END AUTOGEN:permissions -->` markers in `docs/settings-reference.md`.
- **`docs/settings-reference.md`** — "Complete current rule list" subsection with `<!-- BEGIN/END AUTOGEN:permissions -->` markers, populated by the generator.
- **`tests/docs-permissions.test.ts`** — freshness test: asserts the committed block equals `buildPermissionsBlock()` output; a hand-edit or permissions change without regen fails `bun test`.
- **`package.json`** script `docs:permissions`.

## [11.8.2] — 2026-05-26

Documentation reconciliation — bring docs in line with the v11.5.0–v11.8.1 releases. (The obvious churn — `parallelmax-judge`, worktree-hook scripts, the `strict→passthrough` prose, version/skill counts — was already kept current in-flight; this catches what drifted.)

### Fixed

- **Hook-event count** corrected to **29** in `CLAUDE-FULL.md`, `MANUAL.md`, `hooks/README.md`, and `docs/hooks-reference.md` (was a mix of stale `27` and an off-by-one `30`). 29 = the manifest `knownHookEvents` and the official docs.
- **`docs/settings-reference.md` permission snapshot** was a hand-maintained mirror that had drifted (it listed `Bash(curl|find|env|xargs|awk|vitest):*` as allowed — all removed in v11.7.0 — and even showed `node -e`/`node -p` under *allow* when they're *denied*). Replaced the enumerated allow/deny copy with a drift-resistant categorical summary that names `config/30-permissions.json` as authoritative (`bun run compose` shows the live set) and documents the v11.7.0 hardening + cp/mv worm-gap denies.

### Changed

- **`docs/agent-models.md`** now documents `CLAUDE_CODE_SUBAGENT_MODEL` (the session-level Agent-Teams teammate model lever, set to `sonnet` in v11.6.0) alongside the per-agent routing table.

## [11.8.1] — 2026-05-26

Process hardening prompted by two recurring implementer failures observed while shipping v11.6.0 and v11.8.0: the agent (1) hand-wrote a generated file (`schemas/settings.schema.json`) instead of running the emitter — and got it wrong — and (2) reported "commands to run" instead of actually running its verification gate. Both slipped past local checks and would only have been caught by post-push CI.

### Added

- **Schema-freshness test** — `tests/schemas.test.ts` now asserts every committed `schemas/*.schema.json` is byte-identical to emitter output. A stale or hand-written generated schema now fails the normal `bun test` run, not just the post-push CI `schemas` job. `src/schemas/emit.ts` was refactored to export `buildSchema()` / `targets` / `OUT` and guard its disk writes behind `import.meta.main`, so importing it (from the test) no longer writes files.

### Changed

- **`agents/implementer.md` guardrails** — the Verification Checklist now requires the agent to (a) run verification commands itself and paste real pass/fail counts + commit SHA (a list of "commands to run" is explicitly NOT acceptance), and (b) regenerate generated files via their generator and never hand-write them (`bun run schemas:check` must be clean).
- **`src/schemas/settings.ts`** — added a schema-authoring note: prefer permissive enum supersets over doc-literal values, since Claude Code persists values its docs omit (`effortLevel: "max"`, `teammateMode: "in-process"`) and passthrough tolerates unknown keys but not invalid values of known keys. Codifies the v11.7.1/v11.8.0 lesson.

## [11.8.0] — 2026-05-26

Reconcile the `Settings` zod schema with the full documented Claude Code settings surface and relax `.strict()` → `.passthrough()`. Claude Code writes undocumented keys (`theme`, `agentPushNotifEnabled`, `enabledPlugins`) to `settings.json`, so `.strict()` could never validate a real live file — installs worked only because `setup.ts` uses `safeParse` with a raw fallback. This release fixes the schema to reflect reality: passthrough tolerance for undocumented keys, typed coverage expanded from ~39 → 96 keys (the documented surface is ~104; the remainder are tolerated via passthrough), and a new fragment typo-guard test that replaces the old strict check for our own `config/*.json` fragments. `TeammateMode` gains the doc-canonical `in-process` and `tmux` variants. Schema re-emitted so `schemas/settings.schema.json` matches (`additionalProperties` flips `false` → `{}`).

### Changed

- `src/schemas/settings.ts`: root `.strict()` → `.passthrough()` with explanatory comment
- `src/schemas/settings.ts`: `TeammateMode` enum extended to `auto | in-process | tmux | manual | disabled`
- `upstream/claude-code-manifest.json`: `knownSettingsKeys` updated to mirror full `Settings.shape` (39 → 96 keys)
- `schemas/settings.schema.json`: re-emitted; `additionalProperties` is now `{}` (passthrough)
- `tests/schemas.test.ts`: "rejects unknown top-level keys (strict)" → "accepts unknown top-level keys (forward-compat passthrough)"
- `tests/setup.test.ts`: "unknown top-level key → success:false" → "success:true"; `safeParse failure` test switched to type-error input

### Added

- `src/schemas/settings.ts`: ~65 new optional fields covering GENERAL, ENTERPRISE/MANAGED, AUTH/PROVIDER, and UX key groups (see schema comments for per-field descriptions)
- `tests/schemas.test.ts`: "composed fragments contain only known keys" — typo-guard replacing the old strict check
- `tests/schemas.test.ts`: positive test asserting `tui:"fullscreen"`, `editorMode:"vim"`, `autoUpdatesChannel:"latest"`, `teammateMode:"in-process"` → success:true
- `tests/schemas.test.ts`: negative test asserting `tui:"bogus"` → success:false (enum still validates known keys)
- `docs/settings-reference.md`: "## Complete settings.json key reference" table (all ~104 keys with type, class, description)

### Fixed

- `Settings.safeParse` on a real live `~/.claude/settings.json` now returns `success:true` instead of failing on undocumented keys written by Claude Code
- `effortLevel` enum widened to include `"max"` — real live configs persist `effortLevel: "max"` (the env var's full range), which the key's docs omit. Passthrough tolerates unknown *keys* but not invalid *values* of known keys, so without this the live file still failed validation on this one field. Verified: the actual live `~/.claude/settings.json` now validates end-to-end.

### Files changed

- `src/schemas/settings.ts`
- `upstream/claude-code-manifest.json`
- `schemas/settings.schema.json`
- `tests/schemas.test.ts`
- `tests/setup.test.ts`
- `docs/settings-reference.md`
- `src/setup.ts`
- `CHANGELOG.md`

## [11.7.1] — 2026-05-26

Schema gap-fill: two settings keys Claude Code writes to `settings.json` were missing from our `Settings` schema, so the `.strict()` parse rejected real configs (the `safeParse` forward-compat fallback in `setup.ts` kept installs working, but the schema was wrong). Surfaced when the live `~/.claude/settings.json` failed a strict parse with five unrecognized keys; each was verified against the official settings docs before adding — three were **not** documented and deliberately left out.

### Adopted

- **`effortLevel`** (string: `low` | `medium` | `high` | `xhigh`) — persists the effort level across sessions; the `settings.json` counterpart of the `CLAUDE_CODE_EFFORT_LEVEL` env var. Note the key's docs omit `max`, which only the env var accepts. Added to `src/schemas/settings.ts`, `knownSettingsKeys`, and `docs/settings-reference.md`.
- **`skipDangerousModePermissionPrompt`** (boolean) — skips the confirmation before entering bypass-permissions mode; ignored in project settings so untrusted repos can't auto-bypass. Same three files.

### Verified but NOT added

- **`theme`**, **`agentPushNotifEnabled`**, **`enabledPlugins`** — present in the live settings.json (written by the app) but **absent from the official settings reference**, so not added to the strict schema. (`enabledPlugins` was rejected as undocumented in the v11.5.0 article audit too — that call stands.) The `safeParse` fallback continues to tolerate them at install time.

> **Larger finding (not addressed here):** the official settings reference now documents ~90 top-level keys; our schema tracks ~39. The `.strict()` schema is therefore narrower than reality for many real (mostly enterprise/managed/UX) keys — installs are unaffected thanks to the `safeParse` fallback, but a fuller schema/manifest reconciliation is worth a dedicated pass.

## [11.7.0] — 2026-05-26

Security hardening of the permission allowlist (`config/30-permissions.json`) — the manual equivalent of a `/less-permission-prompts` consolidation pass, done as a security-reviewer audit.

### Removed from `allow`

- **Five arbitrary-execution backdoors** — `Bash(curl:*)`, `Bash(find:*)`, `Bash(env:*)`, `Bash(xargs:*)`, `Bash(awk:*)`. Each let an adversarially-constructed command bypass *every other* restriction in the file (`find -exec`, `env VAR=x cmd`, `xargs cmd`, `awk 'system()'`, and curl's write/exfil flags), and the deny list — a string/glob blocklist — could not reliably close those gaps. Removing them means those commands now **prompt** instead of running silently; `Glob`/`Grep`/`LS`/`jq`/`printenv` cover the legitimate uses.
- **`Bash(vitest:*)`** — dead entry; the repo runs `bun test`, vitest isn't installed. (`Bash(lighthouse:*)` was intentionally kept — the lighthouse skill shells out to it.)

### Added to `deny` (defense-in-depth)

- **cp/mv worm-gap** — `Bash(cp|mv * → ~/.claude/settings.json | ~/.claude.json | ~/.zshrc | ~/.bashrc | ~/.bash_profile)`. The `Write` tool is denied on these paths, but shell `cp`/`mv` (still allowed) bypassed that — the exact Shai-Hulud persistence vector `SECURITY.md` targets.
- **curl flag hardening** — `-o`/`-O` (write-to-disk), `-H`/`--header`/`--cookie` (header/cookie exfil), `-X DELETE`/`-X PATCH` (mutating methods), mirroring the existing POST/PUT denies.
- **`gh api --method DELETE`** (complements the existing `-X DELETE` deny), **`find * -exec`**, and **`git push --force-with-lease`** (the force-push denies missed the lease variant).

> **Note on caveats:** allow *removals* are deterministic (unmatched → prompt). Deny *additions* match by string/glob, so mid-command flag patterns are best-effort defense-in-depth — they never reduce safety, but shouldn't be relied on as the sole guard. The removals are the robust fix.
>
> **Live reconcile:** the installer's merger preserves user-only `allow` rules, so re-running `setup.sh` will NOT drop the five backdoors from an existing `~/.claude/settings.json` — they must be removed from the live file directly (the new denies *do* propagate via merge). Fresh installs get the hardened set automatically.

## [11.6.1] — 2026-05-26

Hotfix: revert the `WorktreeCreate` / `WorktreeRemove` hooks shipped in v11.6.0. They broke worktree creation. In Claude Code's harness, `WorktreeCreate` is a **provisioning** hook — it is expected to create the worktree and return its path (echo the path to stdout / `hookSpecificOutput.worktreePath`). The v11.6.0 scripts were logging-only and returned nothing, so worktree creation failed with "hook succeeded but returned no worktree path," which broke agent spawning and any `EnterWorktree` flow. A passive, observability-only `WorktreeCreate` hook is not viable in this harness.

### Removed

- **`WorktreeCreate` / `WorktreeRemove` hook wiring** in `config/40-hooks.json` and the scripts `src/scripts/worktree-create.ts` / `worktree-remove.ts`. Both command patterns were added to `DEPRECATED_COMMAND_PATTERNS` (`src/lib/settings-merge.ts`) so the merger prunes any lingering reference from an upgrader's live `settings.json`. Docs reverted in `docs/hooks-reference.md` (the generic event-table rows describing the upstream events remain; only the "we wire these scripts" claims were removed). The worktree tests in `tests/phase2-scripts.test.ts` were removed.

Everything else from v11.6.0 stands: `CLAUDE_CODE_SUBAGENT_MODEL`, the `TaskCompleted` hook, the three new tracked hook events, the three new env vars, the `duration_ms` docs, and the sandbox schema fields are unaffected.

## [11.6.0] — 2026-05-26

Gap-fill bundle adopting verified Claude Code capabilities (v2.1.117–v2.1.147) and closing manifest/schema/doc drift: subagent model routing, TaskCompleted + WorktreeCreate/Remove hooks, three new tracked hook events, three new env vars, `duration_ms` docs, sandbox schema fields.

### Adopted

- **`CLAUDE_CODE_SUBAGENT_MODEL` env var (upstream v2.1.147)** — routes Agent Teams teammate subprocess sessions to Sonnet while the main session keeps its pinned Opus model. Set to `"sonnet"` in `config/10-core.json`; documented in `docs/settings-reference.md` and added to `upstream/claude-code-manifest.json` `knownEnvVars`.
- **`TaskCompleted` hook (upstream)** — wired in `config/40-hooks.json` to `swarm-log.ts complete`, logging task completion to `~/.claude/swarm.log`. Mirrors the existing `TaskCreated` handler. `swarm-log.ts` updated with the new `complete` arg.
- **`WorktreeCreate` / `WorktreeRemove` hooks (upstream)** — new async, fail-open scripts (`src/scripts/worktree-create.ts`, `src/scripts/worktree-remove.ts`) log worktree lifecycle events to `~/.claude/logs/worktree.log`. Pure observability; always exit 0, emit no output that could alter worktree behavior. Wired in `config/40-hooks.json`.
- **`Setup`, `UserPromptExpansion`, `PostToolBatch` hook events** — three events documented upstream but absent from our schema. Added to `HookEvent` enum in `src/schemas/hooks.ts` and to `knownHookEvents` in `upstream/claude-code-manifest.json` (alphabetical order).
- **`CLAUDE_CODE_SHELL_PREFIX` (v2.1.128)**, **`CLAUDE_CODE_SUBAGENT_MODEL` (v2.1.147)**, **`OTEL_LOG_TOOL_DETAILS` (v2.1.117)** — three env vars tracked upstream but missing from our manifest. Added to `knownEnvVars` (alphabetical) and documented in `docs/settings-reference.md`.

### Fixed

- **`duration_ms` in `PostToolUse` / `PostToolUseFailure` docs** — upstream added `duration_ms` (tool execution time, excluding permission prompts and PreToolUse) to both hook payloads in v2.1.119. Documented in the event-specific-variables table in `docs/hooks-reference.md`.
- **Sandbox schema fields** — `src/schemas/settings.ts` `Sandbox` schema was missing `enableWeakerNetworkIsolation` (macOS weaker network isolation for MITM proxy verification) and `filesystem.allowWrite` (list of paths re-allowed inside denyWrite regions). Both were referenced in `docs/settings-reference.md` but rejected by the schema. Added with inline comments.
- **`CLAUDE_CODE_ENABLE_AWAY_SUMMARY` docs** — already in `knownEnvVars` but undocumented. Added row to the env table in `docs/settings-reference.md` (v2.1.110; on by default; set `=0` to opt out).
- **`setup-args` test robustness** — `parseArgs > defaults` asserted `sourceDir` matched `/cc-settings$/`, which failed whenever the suite ran inside a git worktree (path ends in `agent-<hash>`, not `cc-settings`). Loosened to a `toContain("cc-settings")` substring check that holds in both a normal checkout and a worktree.

### Files changed

- `config/10-core.json`
- `config/40-hooks.json`
- `docs/hooks-reference.md`
- `docs/settings-reference.md`
- `src/schemas/hooks.ts`
- `src/schemas/settings.ts`
- `src/scripts/swarm-log.ts`
- `src/scripts/worktree-create.ts` (new)
- `src/scripts/worktree-remove.ts` (new)
- `src/setup.ts`
- `upstream/claude-code-manifest.json`
- `tests/schemas.test.ts`
- `tests/phase2-scripts.test.ts`
- `tests/setup-args.test.ts`
- `CHANGELOG.md`

## [11.5.1] — 2026-05-26

Bug fix: remove the `parallelmax-judge.ts` Stop hook. It spawned a nested `claude -p --model haiku` session on every turn that tripped the parallelmax counter (≥ 5 non-Agent tool calls). That nested session ran the full SessionStart hook chain — so its `PROJECT CONTEXT` banner and the judge's own `<conversation-excerpt> … DELEGATE/OK` prompt leaked onto the user's terminal, looking like "every new terminal starts with this." It was also the only place in the codebase that spawned a nested `claude`, and cost a full extra Claude session per tripped Stop with only debounce-bounded recursion protection.

### Removed

- **`src/hooks/parallelmax-judge.ts`** and its `Stop` wiring in `config/40-hooks.json` (the `Stop` event now runs only `stop-summary.ts`). Delegation enforcement is unchanged in intent: the deterministic, zero-cost `parallelmax-nudge.ts` (PostToolUse, N=8) and `delegation-detector.ts` remain. Docs updated in `docs/hooks-reference.md`, `docs/settings-reference.md`, `MANUAL.md`, and `hooks/README.md`.

### Fixed

- **Installer prunes the stale judge reference automatically.** Added `parallelmax-judge.ts` to `DEPRECATED_COMMAND_PATTERNS` in `src/lib/settings-merge.ts`, so upgraders whose live `settings.json` still carries the old `Stop` group (`stop-summary` + judge) get the judge pruned on the next install rather than firing a dangling reference forever.
- **No duplicate `stop-summary` after a partial prune.** The hook merger previously re-added a partially-pruned user group as a "user extra" even when pruning had collapsed it into a group the team already provides — leaving two `stop-summary` entries. `hooksStrategy` now drops a pruned group that matches a team-provided group. Covered by new cases in `tests/settings-merge.test.ts`.

> Re-run `setup.sh` after upgrading so the installer drops the stale `~/.claude/src/hooks/parallelmax-judge.ts`, prunes the dangling `Stop` reference, and refreshes the `verify-hooks` fingerprint for the new `Stop` block.

## [11.5.0] — 2026-05-25

Sync with Claude Code v2.1.150 plus an audit-driven gap-fill that adds three previously-missing real settings keys our schema didn't accept yet. v2.1.150 itself was internal infrastructure only.

### Adopted

- **`allowAllClaudeAiMcps` managed setting (upstream v2.1.149)** — boolean that loads the claude.ai cloud MCP connectors alongside the locally-configured `managed-mcp.json`. Added to `src/schemas/settings.ts` (sits next to `allowedMcpServers` / `deniedMcpServers`), enumerated in `upstream/claude-code-manifest.json` `knownSettingsKeys`, and documented in `docs/settings-reference.md` with a JSON example. Lets orgs opt into the full claude.ai MCP catalogue without enumerating each connector locally.
- **`cleanupPeriodDays`** — real upstream key (number, default 30, min 1) controlling transcript and orphaned-worktree retention at startup. Previously missing from cc-settings schema so user configs that set it failed the `.strict()` parse. Schema gap-fill flagged during a settings-audit pass against the upstream docs.
- **`enabledMcpjsonServers` / `disabledMcpjsonServers`** — real upstream string-array keys that allow/block specific MCP servers declared in project-level `.mcp.json` files. Distinct from `allowedMcpServers` / `deniedMcpServers` (URL patterns); these match by server name. Same audit-pass gap-fill — both were missing from our schema and manifest.

### Deletions / Native-now-redundant

_None this cycle._ The remaining v2.1.149 bullets are upstream bug fixes (PowerShell `cd` bypass, sandbox worktree allowlist, `find` macOS vnode crash, status-bar effort display, several UI freezes) — no cc-settings code wrapped or asserted on the affected behavior, so nothing to remove.

### Files changed

- `src/schemas/settings.ts`
- `upstream/claude-code-manifest.json`
- `docs/settings-reference.md`
- `src/setup.ts`
- `CHANGELOG.md`

## [11.4.0] — 2026-05-22

New `/nuclear-review` skill ships alongside a self-applied audit pass that closes 11 findings across both audits — MANAGED_SKILLS duplication, `runGit` triplicate, `pad()` consolidation, `readJsonOrNull<T>` type-lie, `Strategy` key threading, safety-net spaghetti, zod-4 deprecations, dead code. Net: −150 LOC of duplication/cruft, +1 skill, +1 lib module, +1 lib export, +2 safety-net helpers. No behavior change in any common path; one interactive-merge UX bug (`"<scalar>"` placeholder) fixed.

### feat: nuclear-review skill — whole-codebase audit + context7 dependency check + Phase 4 docs pass

New `/nuclear-review` skill — unusually strict **whole-codebase** maintainability audit. Structural rubric adapted from `cursor/plugins/cursor-team-kit/skills/thermo-nuclear-code-quality-review` (reported by Eric Zakariasson as Cursor's most-used internal skill); cc-settings extends Cursor's per-diff scope to the whole repo and adds a **context7-driven dependency audit** phase that checks currency, deprecated API usage, role-duplication, and maintainer-recommended usage patterns for every direct dependency, plus a **Phase 4 documentation updates** that keeps CHANGELOG / MANUAL / derived schemas in sync whenever audit findings turn into commits (so audit-driven refactors don't ship as anonymous history). Flags every 1k-line file, thin wrapper, leaked-logic boundary, and pushes "code-judo" moves that delete whole branches instead of rearranging them. Frontmatter declares `requires: [{ mcp: context7 }]` so the installer warns when the MCP server is missing. Sibling to `/review` (per-PR Darkroom checklist) and `/zero-tech-debt` (rework patch to end-state). Skill count 26 → 27 (soft cap still 40). Triggers include "nuclear review", "thermonuclear review", "code judo", "whole codebase review", "harsh maintainability review". Wired into `MANUAL.md` and skill-count references in `CLAUDE.md` / `CLAUDE-FULL.md`.

### refactor: extract MANAGED_SKILLS to src/lib/managed-skills.ts

The 50-entry `MANAGED_SKILLS` array (active list + upgrade-cleanup tombstones) was duplicated verbatim across `src/setup.ts` and `src/lib/status.ts` — every new skill required edits in two places and the duplication had already drifted in prior commits. Extracted to a single `src/lib/managed-skills.ts`; `status.ts` re-exports for callers that already import from it. Net: −114 LOC removed, +70 added, drift risk eliminated. First nuclear-review code-judo finding.

### refactor: nuclear-review hygiene — z.url() + pad() consolidation

Two findings from the first nuclear-review audit applied in one commit:

1. **zod v4 idioms.** Two call sites still used `z.string().url()`, deprecated in zod 4 in favor of the top-level `z.url()`. Swapped `src/schemas/mcp.ts:39` and `src/schemas/hooks.ts:68`.
2. **`pad()` consolidation.** A one-line zero-pad helper was reimplemented in `src/scripts/checkpoint.ts`, `src/scripts/handoff.ts`, and `src/scripts/log-bash.ts`. Lifted from `src/lib/platform.ts` (previously buried as a local inside `getTimestamp`) to a module-level export; the three scripts now import it. Net: −9 LOC across the scripts, single canonical helper.

### refactor: thread key through Strategy in settings-merge

Closes the last deferred finding from the second-pass `/nuclear-review`. `userWinsScalarStrategy` previously called `resolveScalarConflict` with a literal `"<scalar>"` placeholder because the orchestrator didn't pass the key it was iterating over. Visible to anyone running `setup.sh --interactive` with a top-level scalar conflict on an unknown key — the prompt read "<scalar> differs between your settings and team" instead of e.g. "model differs…".

Threaded `key: string` as the first parameter of the `Strategy` type. The orchestrator at `src/lib/settings-merge.ts:451` now passes the current key. `userWinsScalarStrategy` uses it in the `resolveScalarConflict` call; the other four strategies (`permissions`, `hooks`, `env`, `statusLine`) accept it as `_key` because they label their internal sub-prompts with hardcoded paths like `permissions.${k}` already. 20 test call sites in `tests/settings-merge.test.ts` updated to pass the strategy's registered key (`"permissions"`, `"hooks"`, `"env"`, `"statusLine"`, `"model"` for the generic scalar tests).

No behavior change for non-interactive merges. Interactive merge prompts now name the conflicting key.

### refactor: nuclear-review batch 2 — runGit consolidation + pad mop-up + safety-net cleanup

Seven mechanical findings from the second-pass `/nuclear-review`:

1. **`runGitFull` lifted to `src/lib/git.ts`.** New rich-shape variant returns `{ exit, stdout, stderr }` so scripts that need failure inspection or stderr stop rolling their own. Removed the two local copies in `src/scripts/checkpoint.ts` and `src/upstream/scan.ts`. The string-returning `runGit` is unchanged; common-path callers stay simple.
2. **`pad()` consolidation finished.** Two more inline reimplementations dropped from `src/scripts/stop-failure.ts` and `src/scripts/claude-audit.ts` in favor of the canonical export from `src/lib/platform.ts` (the morning pass caught 3; this pass catches the remaining 2).
3. **`safety-net.ts checkRmRf`** — six `$HOME` / `${HOME}` literal comparisons collapsed into `HOME_PATH_PREFIXES` + `isExactHomePath` / `startsWithHomePath` helpers, used in both the BLOCK and ALLOW paths.
4. **`safety-net.ts stripGitGlobalOpts`** — four near-identical regex branches collapsed into a `GIT_GLOBAL_OPT_PATTERNS` array + single loop.
5. Dropped unused `stat` import from `src/scripts/checkpoint.ts`.
6. Deleted stale "Phase 3 will replace…" comment from `src/scripts/session-start.ts` — the replacement shipped in v10.x.
7. Made `cmdList` / `cmdClean` in `checkpoint.ts` async-consistent (`readdir` / `unlink` instead of `*Sync` variants; matches `cmdSave`'s existing pattern).

The `<scalar>` placeholder fix called out as "deferred" in the commit message landed in the next commit (see *thread key through Strategy* entry above). The other deferred item — `claude-audit.ts` date helpers — stays in-file (single consumer; premature to extract).

No behavior change. Typecheck clean, biome clean, lint:skills clean.

### refactor: drop readJsonOrNull&lt;T&gt; type-lie

The `<T>` generic on `src/lib/mcp.ts:readJsonOrNull` was a fiction — callers got `T | null` but the value was actually `unknown` dressed as `T` via a cast inside the function. Every meaningful caller did its own pattern-match or safeParse anyway, so the type parameter only obscured the boundary that v11.3.1's safeParse closure work was meant to guard. Dropped the generic; signature is now `(path: string) => Promise<unknown>`. The four meaningful callers (`src/setup.ts`, `src/lib/status.ts` ×2, `src/lib/settings-merge.ts` ×2 already cast) cast at the call site, making the unsafety visible. Closes finding 3 from the nuclear-review audit. No behavior change.

## [11.3.1] — 2026-05-22

### refactor: dependency review + safeParse boundary closure + upstream sync 2.1.148

Post-11.3.0 cleanup pass driven by a context7 audit of every runtime dependency.

**Dependency review (`@inquirer/prompts`, `yaml`, `zod`)**

- `@inquirer/prompts` ^8.4.2 → `@inquirer/confirm` ^6.0.13. We only ever used `confirm`; the standalone subpackage has a smaller install footprint with no API change beyond the default-import form.
- `yaml`: 3 call sites collapsed through the canonical `src/lib/frontmatter.ts:parseFrontmatter`. New `parseFrontmatterStrict` uses `parseDocument` so the skill linter now reports YAML errors with line, column, and zod error code — e.g. `"BLOCK_AS_IMPLICIT_KEY at line 3, col 14: Nested mappings are not allowed in compact mappings"` instead of a bare message.
- `zod`: dropped the `(Settings as unknown as { shape: ... }).shape` cast in `src/upstream/scan.ts` — zod 4 types `.shape` publicly, no cast needed.

**safeParse at JSON-deserialize boundaries (two commits)**

`~/.claude/settings.json` and `~/.claude.json` are user-controlled. Hot read paths previously cast `JSON.parse(...)` as the expected type without validation. Closed the gap at five sites:

- `src/lib/mcp.ts` — `readMcpFromSettings` validates via `McpServers.safeParse`; logs debug + returns `{}` on failure. `installMcpToClaudeJson` validates team + current reads; logs debug and preserves raw on failure to avoid data loss on forward-compat drift (design choice documented inline).
- `src/lib/audit-hooks.ts` — `auditSettingsFile` validates the hooks block against `HooksBlock`; schema mismatch surfaces as an audit finding (severity `unknown`) instead of crashing the audit.
- `src/setup.ts` — `installSettings` validates via `Settings.safeParse`; fingerprint best-effort on schema failure (forward-compat).
- `src/lib/settings-merge.ts` — `mergeSettingsWithMcpPreservation` validates `userRaw` and `teamRaw` at the top; on schema failure logs debug and proceeds with the raw object.
- `src/lib/status.ts` — sentinel file (`.cc-settings-version`) validates against new exported `VersionSentinel` schema; null fields on failure (treat as absent).

zod 4 string parsing is 14.7× faster than zod 3 per the official benchmark, so the perf cost of validation is negligible at these boundaries.

**Upstream sync 2.1.146 → 2.1.148**

Reviewed every change in Claude Code 2.1.147 and 2.1.148:

- 2.1.148: single Bash exit-code-127 regression fix. Inert for cc-settings.
- 2.1.147: ~35 bug fixes (background sessions, auto-updater, hook `if`-pattern parser, PowerShell, MCP pagination, agent view, slash-command edge cases). Inert.
- 2.1.147 single breaking rename: `/simplify` → `/code-review` with semantics changed (now reports correctness bugs at chosen effort, no longer the cleanup-and-fix command). References updated in `skills/refactor/SKILL.md`, `skills/zero-tech-debt/SKILL.md`, `MANUAL.md` to point at `/zero-tech-debt` (in-diff tightening niche).

Schema surface: no new settings keys, hook events, env vars, agent contracts, or MCP fields. Upstream scanner reports no drift after the bump.

**Other**

- Lint cluster: `bun run lint` now reports 0 warnings (was 4 pre-existing — `parallelmax-judge` optional chain, two template-literal-in-string warnings, one non-null assertion). Auto-fix swept imports + formatting across 10 files.
- Stale doc fix: `docs/consolidation-audits/2026-05.md` marks the web-vitals/performance row as superseded by v11.3.0.

**Tests**

303 (pre-11.3.0) → 349 (after 11.3.0 dep work) → 363 (after safeParse extension). +60 across the post-11.3.0 cycle.

## [11.3.0] — 2026-05-21

### refactor: thermonuclear cleanup — skills 37→26, oracle→explore, mcp.ts split, +unit tests

A six-tier cleanup pass across the whole codebase. Behavior-preserving where it mattered (the golden-migration tests still gate everything); ambitious about structural simplification everywhere else.

**Skills consolidation (37 → 26, freed 11 slots)**

- Retired: `audit` (CLI alias), `lenis` (narrow third-party setup), `share-learning` (gh-CLI wrapper; routing rules relocated to `AGENTS.md`).
- Merged: `create-handoff` + `resume-handoff` → `handoff`; `discovery` + `prd` → `plan-feature`; `ask` + `premortem` + `compare-approaches` → `oracle` (three modes); `tdd` folded into `test`; `cc-sync` + `cc-update` → `cc`; `long-task` folded into `orchestrate`.
- Demoted: `write-a-skill` → `bun run new-skill <name>` CLI + `docs/skill-authoring.md`.

**Agents**

- `agents/oracle.md` merged into `agents/explore.md` (blast-radius workflow, evidence-based answer template, never-speculate principles preserved). `Agent(oracle, …)` references across skills/profiles/docs swept to `Agent(explore, …)`.
- `profiles/maestro.md` slimmed 108 → ~40 lines (deep reference is `agents/maestro.md`).
- `agents/planner.md` inline ADR/trade-off/plan templates replaced with pointers to `docs/architecture-reference.md`, `docs/thread-types.md`, `docs/enhanced-todos.md`.
- Self-Evolving Learnings block centralized in `AGENTS.md`; implementer/planner/reviewer reference it instead of duplicating.
- Frontmatter drift: `maxTurns` caps added to scaffolder/tester/deslopper/reviewer; reviewer gains `isolation: worktree`.

**src/ refactor**

- `src/lib/mcp.ts` split 611 → 177 lines. New `src/lib/settings-merge.ts` exports the 5 merge strategies (`permissionsStrategy`, `hooksStrategy`, `envStrategy`, `statusLineStrategy`, `userWinsScalarStrategy`) and the orchestrator individually — previously private closures.
- `cmdStatus` in `setup.ts` (125-line monolith) refactored into `gatherStatus(): StatusData` (new `src/lib/status.ts` + `status-types.ts`) and `printStatus(data)`.
- Shared `src/lib/frontmatter.ts` extracted — was duplicated across `lint-skills.ts`, `skill-prereqs.ts`, `frontmatter-validate.ts`.
- `src/lib/audit-hooks.ts` now uses `Hook`/`HookGroup` from `src/schemas/hooks.ts` instead of local `RawHook*` interfaces (schema-drift fix).
- `src/lib/skill-prereqs.ts` drops the `unknown` cast on `requires` — uses typed `SkillFrontmatter.requires` directly.
- `src/scripts/lint-skills.ts` slimmed to match `audit-hooks.ts` 5-line CLI wrapper style.
- 34 new unit tests across `tests/settings-merge.test.ts` (per-strategy coverage) and `tests/status.test.ts` (gatherStatus on temp fixtures).

**Rules**

- `rules/web-vitals.md` absorbed into `rules/performance.md` (CLS font fallback metrics, PerformanceObserver debug, budgets table); web-vitals deleted. Cluster went 3 files → 2.
- 5 drift instances canonicalized with 1-line pointers at non-canonical locations: React Compiler memoization rule (`rules/react-perf.md`), `&&` with numbers (`rules/react.md`), defer-awaits (`rules/performance.md`), secret file list (`rules/security.md`), typography utilities (`rules/ui-skills.md`).

**Housekeeping**

- `docs/migration-coexistence.md` deleted (self-archived).
- `config/20-mcp.json` `_comment`/`_status` keys stripped (non-standard JSON); relocated to `docs/settings-reference.md`.
- `src/setup.ts` backup-prune loop parallelized.
- `src/lib/packages.ts` linux/wsl probe branches deduplicated.

**README**

- Tightened 356 → 84 lines. Cut marketing prose, comparison table, philosophy, FAQ. Kept: one-sentence pitch, install, what-gets-installed map, common commands, doc pointers.

**Net**

- 38 files modified, ~720 LOC removed from production code/docs.
- 34 new unit tests (303 → 338 passing).
- Skill library at 26/40 with 14 slots of runway.

## [11.2.1] — 2026-05-19

### fix: implementer briefing contract + sync with Claude Code v2.1.144

The upstream v2.1.144 release is a pure bug-fix window — terminal renderer fixes, background-session crashes, MCP pagination, Windows-only fixes — with no new settings keys, hook types, env vars, or agent contracts to adopt. Patch bump on the manifest only.

The substantive change this release is local: **the `implementer` agent now refuses thin prompts and the skills that orchestrate it now construct real briefings instead of emitting unresolved placeholders.**

**Fixed**

- `agents/implementer.md`: added a `REQUIRED BRIEFING` block to the `description:` (visible to orchestrators at delegation time) and a `Briefing Gate` to the system prompt. The agent now audits its own prompt against a 5-item checklist (user ask verbatim, file paths + line ranges, the concrete change to make, verification command, scope boundary) and refuses to start work with a structured "Briefing incomplete: missing X" reply rather than guessing. `isolation: worktree` means implementer boots in a fresh `origin/main` checkout with zero in-session context — a thin prompt was the dominant cause of regressions.
- `skills/fix/SKILL.md`: the Agent Delegation block previously sent the literal string `[summary from explore]` to implementer — a placeholder no harness interpolated. Replaced with orchestrator instructions that build the briefing from prior agent output before invocation.
- `skills/refactor/SKILL.md`: same anti-pattern (`"Refactor according to plan."`) — same treatment, now instructs the caller to paste the actual planner output.
- `profiles/maestro.md`: replaced `[4] Agent(implementer, "implement based on plan")` with explicit "paste the planner output verbatim" wording.
- `CLAUDE-FULL.md` Delegation section: added a briefing-contract callout under the `implementer` rule pointing at the full contract in the agent definition.

**Skipped (upstream bug fixes, no cc-settings surface)**

Captive-portal startup hang (75s → 15s), terminal rendering corruption fixes (window-resize garble, progressive corruption, VS Code spinner glitches, Windows CJK ghost chars), macOS background-session Full Disk Access regression, image-extension-mismatch crash, `head`/`tail` satisfying read-before-edit, `egrep`/`fgrep`/`git grep`/`git diff` exit-code 1 no longer reported as failure, `/branch` in worktrees, Escape in AskUserQuestion notes, IDE / `applyFlagSettings` model selection, resumed-session model retention, Bedrock/Vertex Opus 1M regression (v2.1.129), `forceLoginMethod`/`forceLoginOrgUUID` remote login, MCP paginated `tools/list` dropping pages, MCP SVG MIME fallback, file-descriptor exhaustion in skill dirs (non-`.md` no longer triggers reloads — beneficial side effect for cc-settings), session-title-from-plugin-monitor, Skill tool headless permission regression (v2.1.141), `claude mcp list` silent failure on bad `.mcp.json`, custom `ANTHROPIC_BASE_URL` Haiku fallback, Windows scrolling in attached bg sessions, terminal-close crash, `!` exec Ctrl+C, agent view shell-command rows, Windows arrow-key in `claude agents`, `/bg` / ←-detach preserving `/add-dir`, in-place-edit Edit/Write refusal after detach, `claude respawn` status, `/resume` forked-from-bg, `claude agents`/`claude logs` hang on unresponsive bg service (10s timeout), bg Bash tasks stuck Running, wake-fail marked as startup crash, markdown links in agents, `spinnerVerbs` post-turn restoration, `claude --bg --name` echo, Ctrl+R rename banner, non-git VCS worktree-isolation guard, `CLAUDE_CODE_PLUGIN_PREFER_HTTPS` add/update regression, `/plugin` post-action navigation, `/doctor` exec-form hint, skill-listing truncation moved to `/doctor`, pre-response stream-stall retry, SDK/headless MCP startup overlap (~2s faster), `/extra-usage` → `/usage-credits` rename (we reference neither), survey follow-up hint.

**Files changed**

- `agents/implementer.md`
- `skills/fix/SKILL.md`
- `skills/refactor/SKILL.md`
- `profiles/maestro.md`
- `CLAUDE-FULL.md`
- `upstream/claude-code-manifest.json`
- `src/setup.ts`
- `CHANGELOG.md`

## [11.2.0] — 2026-05-18

### feat: sync with Claude Code v2.1.143

Routine upstream sync covering 2.1.140 → 2.1.143. Adopts the new contracts (env vars, settings field, hook output field) so the zod schemas accept them and the docs reference them. Most of the upstream churn in this window is UI/plugin/Windows fixes that have no cc-settings surface.

**Adopted**

- `worktree.bgIsolation: "none"` setting (v2.1.143) — `src/schemas/settings.ts`. Lets background sessions edit the working copy directly without `EnterWorktree`. For repos where worktrees are impractical.
- `terminalSequence` hook output field (v2.1.141) — `docs/hooks-reference.md`. Hooks can emit desktop notifications, window titles, and terminal bells through their JSON output without a controlling terminal. (Docs-only; the zod schema models hook input, not output.)
- 6 new env vars in `knownEnvVars` (manifest) + env-vars table:
  - `ANTHROPIC_WORKSPACE_ID` (v2.1.141) — workspace-scoped workload identity federation
  - `CLAUDE_CODE_PLUGIN_PREFER_HTTPS` (v2.1.141) — HTTPS clone for plugin sources behind SSH-blocking proxies
  - `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE` (v2.1.142) — pin fast mode to Opus 4.6 (default is now Opus 4.7)
  - `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (v2.1.143) — cap Stop-hook block-loop length (default: 8)
  - `CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY` (v2.1.143) — opt out of PowerShell ExecutionPolicy Bypass default
  - `CLAUDE_CODE_USE_POWERSHELL_TOOL` — already in the manifest; documentation added for the new Windows-default-on behavior

**Deletions / Native-now-redundant**

None this cycle. The `/loop` redundant-wakeup fix (v2.1.140) and the case-insensitive `subagent_type` matching (v2.1.140) are pure upstream improvements; we have no compensating shims to remove.

**Skipped**

~25 upstream entries: plugin-management UX, Windows-only fixes, `claude agents` CLI flag additions, `/feedback`/`/plugin`/`/web-setup` UI, rewind menu, `MCP_TOOL_TIMEOUT` fix, reactive-compaction internal improvement, hook config error wording, agent color palette, settings hot-reload symlink fix, plugin folder-shadowing warnings — none affect schemas, hooks, or our config surface.

**Files changed**

- Modified: `upstream/claude-code-manifest.json`, `src/schemas/settings.ts`, `docs/settings-reference.md`, `docs/hooks-reference.md`, `src/setup.ts` (VERSION 11.1.4 → 11.2.0), `CHANGELOG.md`

---

## [11.1.4] — 2026-05-13

### fix: statusline ↻time-to-reset suffix renders again

The `↻Xh:XXm` reset countdown next to the ⚡ rate-limit segment had been silently missing since Claude Code's statusline payload settled on Unix epoch *seconds* for `rate_limits.five_hour.resets_at`. Our hook called `Date.parse()` on that integer — `Date.parse(1738425600)` returns `NaN`, so `formatTimeToReset` returned `null` and the suffix was dropped without warning. v11.0.5 shipped the feature with an ISO-string mock and never caught the type mismatch against real Claude Code output.

**Fix**

- `src/hooks/statusline.ts`:
  - `formatTimeToReset` now detects epoch-second input (`> 1e9`), multiplies to ms, and falls back to `Date.parse` for ISO strings (legacy/test compatibility).
  - `Payload.rate_limits.five_hour.resets_at` widened to `number | string`. Added `seven_day` block alongside `five_hour` — the official statusline docs list both windows.

**Verified against three payload shapes**

```
epoch seconds (current)   → ⚡30% ↻3h20m
ISO string (legacy)        → ⚡30% ↻3h20m
past timestamp             → ⚡30%        (suffix correctly suppressed)
```

**Files changed**

- Modified: `src/hooks/statusline.ts`, `src/setup.ts` (VERSION 11.1.3 → 11.1.4)

---

## [11.1.3] — 2026-05-13

### feat: 4 React rules folded in from react-doctor research

Evaluated [millionco/react-doctor](https://github.com/millionco/react-doctor) (static analyzer, 9.1k★) and [aidenybai/react-scan](https://github.com/aidenybai/react-scan) (runtime re-render overlay, 21.3k★) as potential cc-settings adoptions. Verdict on both: **skip the tools, fold the worthwhile rule knowledge directly into our path-conditioned `rules/`**.

**Why skip the tools:**
- **react-doctor** is a CI-time static analyzer; cc-settings is prompt-time guidance. The skill it auto-installs into Claude Code is a 4-line CLI wrapper, not encoded rule knowledge. False positives on Next.js Route Handlers (Issue #206) and unclear React Compiler awareness — both load-bearing for Darkroom projects.
- **react-scan** is broken with React Compiler (Issues #378, #229 — compiler-memoized components misreported, or re-renders go silent). Every Darkroom project runs Compiler, so acting on its output could cause engineers to add explicit `memo`/`useMemo` calls the Compiler then fights. No CI mode, so can't slot into `/lighthouse` or `/qa`. Revisit when RFC #207 + #305 land.

**What we DID fold in (4 rules across 2 files):**

- `rules/react.md` — three new DON'Ts:
  - **Don't cascade setState calls** — consolidate to one setter or derive; cascading fights React's batching and creates stale-closure bugs.
  - **Don't put `useState` / `useEffect` / refs in a Server Component** — Next.js App Router build error; split into Server (fetch) + Client (interact) pair.
  - **Don't make a Client Component `async`** — `'use client'` + `async function` = runtime error; the data fetch belongs one boundary up.
- `rules/react-perf.md` — one new bullet in the React Compiler Note section:
  - Inline JSX literals (`<Button style={{ color: 'red' }} onClick={() => doThing()} />`) are FINE under Compiler. The classic "don't put object/function literals in JSX" advice is pre-Compiler folklore. Don't extract them into `useMemo` / `useCallback` to "fix" something the Compiler already handles.

**What we DIDN'T fold:**

`no-barrel-imports` — already covered by `rules/performance.md`'s "Direct imports over barrels" section.

`react-scan`'s runtime-only signals (real-interaction render counts, context-subscriber blast detection) — no prompt-time rule can substitute for runtime observation. Left as a "revisit later" note.

**Files changed**

- Modified: `rules/react.md`, `rules/react-perf.md`, `src/setup.ts` (VERSION 11.1.2 → 11.1.3)

---

## [11.1.2] — 2026-05-13

### chore: doc pass + deslop residue from v11.1.1

Post-v11.1.1 audit pass caught documentation drift the consolidation left behind, plus residual dead code the deslopper found on a deeper sweep. All structural — no behavior changes.

**Documentation — stale references after v11.1.0 + v11.1.1 cuts**

- `CLAUDE.md` — `src/scripts/` description listed "learning" as an example one-shot script; that file was deleted in v11.1.1.
- `CLAUDE.md`, `README.md` — `bench/` description still claimed "Performance benchmarks + regression gate"; only `bench/prototype/` survives. Updated both to name the surviving directory and note the v11.1.1 retirement.
- `hooks/README.md` — `session-start.ts` row described "recalls learnings"; the script now surfaces an auto-memory pointer (the `learning.ts` recall path was retired in v11.1.1).
- `docs/hooks-reference.md` — same `session-start.ts` row update.
- `docs/hooks-reference.md` "Adding New Hooks" → Best Practices — added a bullet pointing hook authors at the new `src/lib/hook-runtime.ts` helpers (`readHookInput`, `readState`, `writeState`, `runHook`) with the three parallelmax hooks named as reference implementations.

**Dead code — `ensureNpmGlobal` function body**

v11.1.1 removed the unused `ensureNpmGlobal` import from `src/setup.ts` but left the function body alive in `src/lib/packages.ts` (~22 lines). Confirmed zero callers across the repo (the only consumer was the retired `docs` skill's install hook). Deleted.

**Files changed**

- Modified: `CLAUDE.md`, `README.md`, `hooks/README.md`, `docs/hooks-reference.md`, `src/lib/packages.ts`, `src/setup.ts` (VERSION 11.1.1 → 11.1.2)

**Sessional learning — worktree base-ref gotcha**

The implementer agent dispatched for this doc pass with `isolation: "worktree"` worked off `origin/main` (still at v11.0.5 since this session's work hadn't been pushed), then overwrote the v11.1.0 doc cleanup on copy-back. Caught it via `git diff HEAD` and restored before committing. Lesson: ALWAYS commit current state before dispatching a worktree-isolated agent so the agent's base ref reflects unpushed work. For truly excellent worktree use, `isolation: "worktree"` + push-or-commit-first is the only safe pattern when local HEAD is ahead of `origin`.

---

## [11.1.1] — 2026-05-13

### refactor: accelerationist cleanup — retire bash-era bench, retire local-tier learning, extract hook-runtime helper

Post-v11.1.0 deslop pass surfaced three orphan systems that the consolidation narrative had implied retired but hadn't actually cut. This release finishes those cuts and extracts a tiny shared library for the new hook trio.

**Deleted — bash-era benchmark harness**

The bench harness pre-dated the bash→TS migration (April 2026). `bench/run-baseline.ts` hardcoded `join(REPO, "scripts")` — a directory deleted when the bash scripts were ported — meaning every run silently timed nothing and produced garbage numbers. `bench/regression-check.ts` chained into it. `bench/baseline-bash.json` was a frozen snapshot from the bash era. The `bench:baseline` / `bench:check` package.json scripts and the CI job that ran them were also dead.

- `bench/run-baseline.ts`, `bench/regression-check.ts`, `bench/baseline-bash.json` — deleted (`git rm`).
- `package.json` — removed `bench:baseline` and `bench:check` script entries. `prototype:compile` (which points at `bench/prototype/`) preserved.
- `.github/workflows/ci.yml` — removed the `bench:` job that ran `bun run bench:check` on macOS.
- `CLAUDE.md` (project-level) — removed the two `Bench baseline` / `Bench regression` lines from the Development commands list.

`bench/prototype/` is untouched — it's unrelated exploratory code.

**Deleted — `learning.ts` local tier (finishing the v11.1.0 retirement)**

The v11.1.0 CHANGELOG declared the local tier "folded into auto-memory" but the underlying `src/scripts/learning.ts` (~350 lines) and three call-site references survived. Auto-memory at `~/.claude/projects/<hash>/memory/` is the cc-settings-blessed local store. This release deletes the script and updates its three callers.

- `src/scripts/learning.ts` — deleted.
- `src/scripts/session-start.ts` — removed the Learnings block that read from `~/.claude/learnings/<project>/learnings.json`; replaced with a one-line auto-memory pointer.
- `src/scripts/stop-summary.ts` — replaced the `learning.ts store` invocation hint with an auto-memory-equivalent pointer.
- `skills/consolidate/SKILL.md` — replaced the `learning.ts recall all | wc -l` count with a `find ~/.claude/projects/*/memory -name "*.md"` count; replaced the prune-bash block with prose about reviewing auto-memory entries.
- `skills/README.md` — updated the recall example that still referenced `learning.ts`.

**Added — `src/lib/hook-runtime.ts` (53 lines, four helpers)**

The three new v11.1.0 hooks (`parallelmax-nudge`, `delegation-detector`, `parallelmax-judge`) duplicated three patterns:

1. `Bun.stdin.text()` → JSON parse → env-var fallback
2. read/write a state file at `~/.claude/tmp/<name>.json`
3. top-level `try { await main(); } catch {}` fail-open wrapper

Extracted to `src/lib/hook-runtime.ts` exporting `readHookInput<T>()`, `readState<T>(name, fallback)`, `writeState(name, data)`, and `runHook(main)`. Refactored all three hooks to use the helpers — behavior identical, just less repetition.

| Hook | Before | After | Delta |
|---|---|---|---|
| `parallelmax-nudge.ts` | 85 | 61 | −24 |
| `delegation-detector.ts` | 88 | 77 | −11 |
| `parallelmax-judge.ts` | 165 | 145 | −20 |

Net: +53 (new lib) − 55 (across three hooks) = −2 lines, but every future hook gets the helpers for free, and the cc-settings supply-chain auditor still classifies all three as `trusted` (the helper lives under `src/lib/` which is one of the three allowlisted directories).

**Also fixed**

- `skills/share-learning/SKILL.md` — the body invoked `learning.ts store --shared` which never existed in the TS port (the `--shared` flag was a documentation aspiration, never implemented). Replaced with direct `gh project item-create` invocations.
- `src/setup.ts` — removed unused `ensureNpmGlobal` import (orphan from when the retired `docs` skill installed npm globals; pre-existing lint error).

**Files changed**

- Deleted: `bench/run-baseline.ts`, `bench/regression-check.ts`, `bench/baseline-bash.json`, `src/scripts/learning.ts`
- Added: `src/lib/hook-runtime.ts`
- Modified: `package.json`, `.github/workflows/ci.yml`, `CLAUDE.md`, `src/setup.ts`, `src/scripts/session-start.ts`, `src/scripts/stop-summary.ts`, `src/hooks/parallelmax-nudge.ts`, `src/hooks/delegation-detector.ts`, `src/hooks/parallelmax-judge.ts`, `skills/consolidate/SKILL.md`, `skills/share-learning/SKILL.md`, `skills/README.md`

### infra: VERSION 11.1.0 → 11.1.1

Patch bump — refactors and cleanups, no new features.

---

## [11.1.0] — 2026-05-13

### feat: parallelmaxxing hooks — counter the Opus 4.7 self-execution bias

Opus 4.7 spawns fewer subagents by default than 4.6 and prefers internal reasoning over delegation. The existing CLAUDE.md delegation rules are rules-as-documentation — read once, then drift. This release wires three runtime hooks that surface the bias in real time rather than relying on the model to police itself.

**Added — `src/hooks/parallelmax-nudge.ts`** (PostToolUse, no matcher)

- File-based counter at `~/.claude/tmp/parallelmax-counter.json`. Increments on every tool call, resets when the `Agent` tool fires (delegation observed).
- At threshold `N=8`, emits a `hookSpecificOutput.additionalContext` payload pointing at `Agent(implementer)` / `Agent(explore)` / `Agent(maestro)` with the live count.
- 60s debounce, then resets the counter so a single nudge doesn't repeat for the next eight calls.
- Pure heuristic — zero LLM cost, microsecond runtime. Fail-open on any read/parse error.

**Added — `src/hooks/delegation-detector.ts`** (UserPromptSubmit)

- Regex-scores the incoming prompt for breadth signals: phrases like "do all", "execute the plan", "across the repo", "every file", "fan out"; path-shaped tokens (`dir/file.ext`); numbered/bulleted lists with 4+ items.
- Phrases score `+2` each; ≥3 path tokens add `+1`; ≥4 list items add `+1`.
- At score ≥ 2, injects a system reminder *before* the model commits to a plan, naming the matched reasons and pointing at maestro / multi-agent delegation.
- Pure regex — zero LLM cost.

**Added — `src/hooks/parallelmax-judge.ts`** (Stop event, counter-gated)

- Reads the parallelmax counter first; returns silently if `count < 5`. Avoids burning Haiku + latency on every turn — only fires on already-suspicious turns.
- Parses the last ~25 events from `transcript_path` (JSONL), extracts the most recent user prompt + the assistant's tool sequence.
- Spawns `claude -p --model claude-haiku-4-5-20251001` with the excerpt + the cc-settings delegation rules; Haiku returns `DELEGATE: <reason>` or `OK`.
- On `DELEGATE`, posts the verdict + reason as `additionalContext`. 10-min debounce; suppresses duplicate reasons; state at `~/.claude/tmp/parallelmax-judge.json`.
- Uses the user's existing Claude Code auth (OAuth on Max plans where Haiku usage is bundled into the subscription — Anthropic's `/goal` docs call this "negligible compared to main-turn spend"). 8s timeout on the spawn; fail-open on any error.

All three hooks follow the cc-settings trusted-command convention (`bun "$HOME/.claude/src/hooks/<name>.ts"`) so the supply-chain auditor classifies them as `trusted`. Verified: `bun run audit:hooks` reports 51 trusted, 0 unknown, 0 suspicious after install.

### refactor: skill consolidation — 38 → 36, plus the `dr-` prefix convention

The user's effective skill count is around 70+ once native Claude Code skills (`loop`, `schedule`, `simplify`, `review`, `init`, `security-review`, `claude-api`, …) and plugins (`sanity:*`, `vercel:*`) load on top of cc-settings. Anthropic's Skills guide flags 20–50 descriptions as the band where the Skill selector starts struggling. The 40 soft cap on cc-settings was protecting our slice while the user already sat past the upper bound. This release tightens our slice and clarifies the cap's scope.

**Deleted — `skills/docs/`**

The Context7 MCP server's own server-level instructions already prompt Claude to use it on any library question. Our `/docs <library>` slash was a re-statement. Updated all cross-references (8 files) to point at the MCP server directly. The "MANDATORY before adding any external dep" rule migrated to natural-language guidance in the affected skills.

**Deleted — `skills/figma/`**

Same shape as `docs` — the Figma MCP server's instructions cover URL parsing, the design-to-code workflow, and `get_design_context` as the primary tool. The `/figma` slash duplicated without adding routing. Updated `skills/qa/SKILL.md` and `MANUAL.md` to route directly to the MCP.

**Renamed — `skills/learn/` → `skills/share-learning/`**

The `learn` skill had two tiers. The local tier wrote to `~/.claude/learnings/<project>/learnings.json` — fully redundant with the auto-memory system in `~/.claude/CLAUDE.md` which writes typed memories (`user`, `feedback`, `project`, `reference`) to `~/.claude/projects/<hash>/memory/`. The shared tier (GitHub Project board, team-wide) is genuinely orthogonal. Narrowed `share-learning` to the shared tier only; local notes defer to auto-memory.

**Renamed — `skills/init/` → `skills/darkroom-init/` → `skills/dr-init/`**

Two consecutive renames in this release. The native Claude Code `/init` (writes a CLAUDE.md file) collides on the slash command. First rename added "darkroom-" to disambiguate; second rename adopts the **new `dr-` prefix convention** for Darkroom-specific cc-settings skills. The `dr-` prefix mirrors the studio's CSS class namespace. Generic skills (`fix`, `build`, `review`, `lenis`, …) stay unprefixed because they apply outside Darkroom; only skills that are useless at a non-Darkroom shop carry the prefix.

**Tightened descriptions (no rename) — `review` and `refactor`**

Both names collide with native Claude Code skills. Rather than rename them (the slashes are well-established), descriptions now disambiguate by scope:

- `review` — "local pre-commit review of unstaged/staged diff against the Darkroom quality checklist; distinct from native `/review` which inspects open PRs."
- `refactor` — "behavior-preserving restructuring of code that is NOT in your current diff; for tightening just-changed code use native `/simplify` instead."

The selector now has a clear signal for which to pick.

**Net change**

38 → 36 cc-settings skills. Four below the 40 cap, headroom for the next two additions before re-evaluating. `bun run lint:skills` passes; the soft-cap warning stays silent.

### feat: `/goal` cross-references in the loop-shaped skills

Anthropic shipped `/goal` (a session-scoped wrapper around a prompt-based Stop hook) — Claude keeps turning until a small/fast model judges a stated condition met. Four cc-settings skills are loop-shaped and now point at it with worked conditions:

- `skills/lighthouse/SKILL.md` — `/goal mobile and desktop scores in all four categories meet their targets, or stop after 20 rounds`
- `skills/tdd/SKILL.md` — `/goal every planned behavior has a passing test and the full suite exits 0`
- `skills/fix/SKILL.md` — `/goal the reproducer test passes and the full suite is green, or stop after 5 attempts`
- `skills/long-task/SKILL.md` — `/goal all phases complete, tsc + lint + tests exit 0, git status is clean`

### security: SECURITY.md — "Don't disable hooks wholesale"

`/goal` is implemented as a session-scoped prompt-based Stop hook and reports itself unavailable if `disableAllHooks` or `allowManagedHooksOnly` is set at any settings level. The new parallelmaxxing hooks have the same dependency. Users who panic-disable hooks after a `verify-hooks` warning would lose both. Added a section to SECURITY.md and a caveat to `docs/settings-reference.md`'s `disableAllHooks` documentation telling users to remove suspicious entries surgically instead. The fingerprint and the in-memory session hooks (`/goal`, custom prompt hooks) coexist cleanly — the fingerprint only hashes the persisted `hooks` block.

### chore: documentation pass — 10 files updated to match the new surface

33 stale references fixed across `README.md`, `MANUAL.md`, `CLAUDE-FULL.md`, `skills/README.md`, `hooks/README.md`, `mcp-configs/README.md`, `docs/frontmatter-reference.md`, `docs/hooks-reference.md`, `docs/settings-reference.md`, and `docs/consolidation-audits/2026-05.md` (addendum block; historical record left intact). Counts, skill rows, hook tables, frontmatter examples, and tree diagrams all reflect the new state. Auto-memory pointers replace `/learn` invocations; the `dr-` prefix convention is now documented wherever Darkroom-specific skill naming comes up.

### infra: VERSION 11.0.5 → 11.1.0

Minor bump for the new hook layer and the consolidation. Installer behavior unchanged. The `MANAGED_SKILLS` array in `src/setup.ts` adds `dr-init` and `share-learning` and keeps `docs`, `figma`, `init`, `learn`, `darkroom-init` in the upgrade-cleanup section so existing installs prune the orphaned directories on next `setup.sh`.

**Files changed**

- New: `src/hooks/parallelmax-nudge.ts`, `src/hooks/delegation-detector.ts`, `src/hooks/parallelmax-judge.ts`, `skills/dr-init/SKILL.md`, `skills/share-learning/SKILL.md`
- Deleted: `skills/docs/`, `skills/figma/`, `skills/learn/` (renamed), `skills/init/` (renamed), `skills/darkroom-init/` (renamed)
- Modified: `config/40-hooks.json`, `src/setup.ts`, `README.md`, `MANUAL.md`, `CLAUDE-FULL.md`, `SECURITY.md`, `AGENTS.md` indirectly, `skills/README.md`, `hooks/README.md`, `mcp-configs/README.md`, `docs/frontmatter-reference.md`, `docs/hooks-reference.md`, `docs/settings-reference.md`, `docs/consolidation-audits/2026-05.md`, `docs/feature-agents-guide.md`, `docs/github-workflow.md`, `docs/knowledge-system.md`, `contexts/web.md`, `contexts/webgl.md`, `profiles/webgl.md`, `skills/build/SKILL.md`, `skills/component/SKILL.md`, `skills/fix/SKILL.md`, `skills/hook/SKILL.md`, `skills/lenis/SKILL.md`, `skills/lighthouse/SKILL.md`, `skills/long-task/SKILL.md`, `skills/qa/SKILL.md`, `skills/refactor/SKILL.md`, `skills/review/SKILL.md`, `skills/tdd/SKILL.md`

---

## [11.0.5] — 2026-05-13

### statusline: 5h-window time-to-reset

The statusline already displayed `⚡<pct>%` for the 5-hour rate-limit usage but didn't surface when the window resets. Most cc-settings users are on Claude Max 100/200 (flat-rate) plans where token cost is fixed but quota matters — knowing time-to-reset is the actionable metric, not dollars.

- `src/hooks/statusline.ts` — reads `rate_limits.five_hour.resets_at` (already in the Payload type, was unused). Computes delta from now, formats as `2h14m` or `45m`. Suppresses when `resets_at` is missing or in the past. Dim-styled suffix appended after the existing percentage: `⚡63% ↻2h14m`.

### agents.md: Cache Discipline section

Added explicit guidance for prompt-cache hygiene under `Context Hygiene`. Anthropic caches index by exact prefix match — small habits (model switching mid-task, editing CLAUDE.md during a session, reordering tool defs) silently trash cache hits. On flat-rate plans cache misses don't cost dollars but burn 5h-window quota and add latency. The section names the five most common patterns to avoid and notes how the existing compact-at-65% rule interacts with caching.

**Files changed**
- `src/hooks/statusline.ts`
- `AGENTS.md`
- `src/setup.ts` (VERSION 11.0.4 → 11.0.5)
- `CHANGELOG.md`

---

## [11.0.4] — 2026-05-12

### security: supply-chain hook defense (Shai-Hulud / npm worm pattern)

In May 2026 the "Mini Shai-Hulud" npm/PyPI worm compromised 172 packages across @tanstack, @mistralai, @guardrails-ai, @uipath, @opensearch-project. Persistence mechanism: post-install payload injects a `SessionStart` hook into `~/.claude/settings.json` that re-executes on every Claude Code session and survives `npm uninstall`. cc-settings now ships three defenses against this attack class.

**Added — Layer 1: Hooks-block fingerprint**

- `src/lib/hooks-fingerprint.ts` — canonicalize-then-SHA256 of the merged settings.json `hooks` block. Key-reorder produces identical hash (canonicalization is stable); injected hooks change the hash.
- `src/hooks/verify-hooks.ts` — SessionStart hook. Re-hashes on every session, compares against `~/.claude/.cc-settings-hooks-fingerprint`. Silent on match; loud terminal banner on mismatch with remediation steps. Fail-open on any internal error (never blocks session start).
- `src/setup.ts` — writes the fingerprint after `installSettings` succeeds. Re-running `setup.sh` refreshes the fingerprint (the intended workflow when users intentionally customize hooks).
- `config/40-hooks.json` — wires `verify-hooks.ts` as the first hook in the `SessionStart` chain (timeout 3s, runs before `session-start.ts`).

**Added — Layer 2: Command auditor**

- `src/lib/audit-hooks.ts` — classifies every hook command in `~/.claude/settings.json` as trusted / unknown / suspicious. Trusted: matches the cc-settings shipped pattern (`bun "$HOME/.claude/src/{scripts,hooks,lib}/<name>.ts"`) or a compound of those. Suspicious patterns flagged: `curl|wget pipe to shell`, `base64 decode + shell`, `eval $(…)`, `node -e`, `python -c`, `/tmp/<exec>`, hidden `node_modules/.bin/`, `atob(…)`, opaque base64 blobs (>250 chars single-token, >85% base64-alphabet density).
- `src/scripts/audit-hooks.ts` — CLI, exits 1 on any suspicious finding.
- `bun run audit:hooks` script entry in `package.json`.

**Added — Layer 3: SECURITY.md threat model**

- `SECURITY.md` — documents the threat, the three defense layers, the allowlist convention (every cc-settings hook starts with `bun "$HOME/.claude/src/…"`), the false-positive workflow (re-run `setup.sh` to fingerprint custom hooks), the compromise-remediation workflow (backup → manual scrub → re-run setup.sh → rotate creds), and what cc-settings deliberately does not do (no auto-quarantine, no npm install blocking, no cryptographic signing). Sources: Snyk, Socket, StepSecurity, Wiz, The Hacker News, Mend.
- `CLAUDE-FULL.md` — one-paragraph reference under the existing Reference section.

**Tests**

- `tests/audit-hooks.test.ts` — 23 cases. Trusted patterns (quoted/unquoted/compound `$HOME` bun commands). Each suspicious pattern positive case. Unknown-but-not-malware cases. Settings-shape walking (event/group/hook indices preserved). File IO (missing file, malformed JSON, real shape). Report formatting.
- `tests/hooks-fingerprint.test.ts` — 16 cases. Canonicalization stability (key-reorder = same hash; array-reorder = different hash, by design). Round-trip write/read. `hooksCount` aggregation across groups. Atomic write (no `.tmp` residue). Verify status table (`match` / `mismatch` / `missing-fingerprint` / `missing-settings`). Malformed settings.json surfaces as mismatch, not silent pass.

**Design notes**

- The auditor never refreshes the fingerprint. If it could, malware could call it to whitelist itself.
- The fingerprint is updated only by `setup.sh`. This is the deliberate trust anchor — the human re-running setup is the "I've verified the current state" signal.
- All cc-settings-shipped hooks match `bun "$HOME/.claude/src/…"`. New hooks added to `config/40-hooks.json` MUST follow this convention; if a third-party tool needs a hook, wrap it in a `src/scripts/<wrapper>.ts` rather than referencing the binary directly. This invariant is what makes both the auditor and fingerprint work.
- Detection is conservative: false positives (unknown) surface as warnings; only explicit malware-pattern matches exit non-zero. We'd rather make humans review than miss a real intrusion or block on benign custom hooks.

**Files changed:**

- `src/lib/audit-hooks.ts` (new)
- `src/lib/hooks-fingerprint.ts` (new)
- `src/scripts/audit-hooks.ts` (new)
- `src/hooks/verify-hooks.ts` (new)
- `tests/audit-hooks.test.ts` (new)
- `tests/hooks-fingerprint.test.ts` (new)
- `SECURITY.md` (new)
- `config/40-hooks.json` (added verify-hooks to SessionStart chain)
- `src/setup.ts` (writes fingerprint after install; bumps VERSION)
- `CLAUDE-FULL.md` (added supply-chain defense section)
- `package.json` (added `audit:hooks` script)
- `CHANGELOG.md`

## [11.0.3] — 2026-05-12

### tooling: skills linter + 40-skill soft cap + strict-spec cleanups

Reviewed Anthropic's "Complete Guide to Building Skills for Claude" (May 2026 PDF) against the 38-skill library. We comply with the spec across the board (kebab-case folders, exact `SKILL.md` casing, frontmatter contract, no README inside, descriptions well under 1024 chars), with three minor angle-bracket frontmatter instances that strict-compliance flagged. Built the linter the audit implied, fixed the cleanups, and codified the skill-count soft cap.

**Added:**

- **`bun run lint:skills`** — mechanizes Reference A's validation checklist programmatically. Walks `skills/*/SKILL.md` and reports per-skill findings by severity (error / warning). Lives in `src/lib/lint-skills.ts` (logic) and `src/scripts/lint-skills.ts` (CLI). Rules enforced:
  - folder name kebab-case (`/^[a-z][a-z0-9-]*$/`)
  - reserved-prefix check (`claude-*`, `anthropic-*`, literal `claude`/`anthropic`)
  - no `README.md` inside skill folder
  - `SKILL.md` exists (exact case)
  - `---`-delimited YAML frontmatter present and parseable
  - frontmatter passes `SkillFrontmatter` zod schema
  - no `<` or `>` chars in frontmatter (raw-text scan — catches passthrough fields like `argument-hint`)
  - frontmatter `name` matches folder name
  - `description` length ≤ 1024 chars (error) / ≥ 50 chars (warning)
  - `description` contains trigger language (`Triggers`, `Use when`, `Use for`, …) — warning when missing
  - skill count ≤ 40 (`SKILL_SOFT_CAP`) — warning when crossed
- **`tests/lint-skills.test.ts`** — 17 new tests covering each rule's positive and negative paths. Total suite: 244 → 261 pass.
- **40-skill soft cap policy** (`CLAUDE-FULL.md`) — Anthropic's guide flags 20–50 as the point where Skill-tool selection degrades. We sit at 38. Adding past 40 should require removing one; the linter surfaces the cap as a warning when crossed.

**Strict-spec cleanups (cheap compliance wins):**

- `skills/autoresearch/SKILL.md` — `argument-hint: "<skill-name>"` → `"[skill-name]"`
- `skills/lighthouse/SKILL.md` — `argument-hint: "<url>"` → `"[url]"`
- `skills/create-handoff/SKILL.md` — description `context >80%` → `context over 80%`
- `skills/tldr/SKILL.md` — description `Auto-invoke for` → `Use for` (caught by the new linter's trigger-language heuristic; aligns phrasing with the rest of the library)

**Why these (and not the rest of the guide)**

cc-settings architecture is past the guide's single-file mindset — we have 38 skills, 25 agents, 11 path-conditioned rules, 5 profiles, hooks, and MCP config installed via git pull, not Claude.ai uploads. Most divergences from the guide are intentional (no `scripts/`/`references/`/`assets/` subdir use, extra frontmatter fields like `context`, `agent`, `requires`, `argument-hint`). The three actions in this release are the only strict-spec gaps worth bridging.

**Files changed:**

- `src/lib/lint-skills.ts` (new)
- `src/scripts/lint-skills.ts` (new)
- `tests/lint-skills.test.ts` (new)
- `skills/autoresearch/SKILL.md`
- `skills/lighthouse/SKILL.md`
- `skills/create-handoff/SKILL.md`
- `skills/tldr/SKILL.md`
- `CLAUDE-FULL.md`
- `package.json`
- `src/setup.ts`
- `CHANGELOG.md`

## [11.0.2] — 2026-05-12

### standards: close three gaps surfaced by the 12-rule CLAUDE.md template

Reviewed Forrest Chang's 12-rule template (the one extending Karpathy's January 2026 4-rule baseline). Most rules duplicate existing cc-settings coverage — Anthropic's base system prompt covers "Think before coding" and "Simplicity first"; our `Edit`-after-`Read` requirement enforces "Read before write" mechanically; `/checkpoint`, `/create-handoff`, and `/compact`-at-65% beat hardcoded token budgets; `rules/*.md` path-conditioning beats "match conventions." Three gaps were real and worth bridging.

**Added (AGENTS.md → installed at `~/.claude/AGENTS.md`):**

- **Fail Loud** guardrail — generalizes existing piecemeal honesty rules (Never Fake Measurements, Visual/Spatial Honesty). "Done" is wrong when anything was skipped, mocked, or unverified — surface it in the final message instead of glossing over partial completion.
- **Surface Conflicts, Don't Average** guardrail — when two existing patterns in the codebase contradict, pick the more recent/tested one and flag the other for cleanup. Never blend conflicting patterns into "average" code that satisfies both.

**Added (`agents/tester.md`):**

- **Test Intent, Not Behavior** principle — tests must encode *why* a behavior matters, not just *what* a function returns. A test that can't fail when business logic changes is testing the implementation, not the contract.
- **Surface Skips** principle — links back to Fail Loud guardrail; never silently `.skip` or `.only` a test.

**Why these three (and not the other nine)**

The post's other rules either duplicated what we already have (often more sharply) or operate at the wrong layer for our setup. cc-settings is past single-file CLAUDE.md mindset — path-conditioned `rules/`, skill architecture, and verification hooks do work that prose can't. Full evaluation in conversation log; not duplicated here.

**Files changed:**

- `AGENTS.md`
- `agents/tester.md`
- `src/setup.ts`
- `CHANGELOG.md`

## [11.0.1] — 2026-05-12

### sync: Claude Code 2.1.139

Two new optional hook fields adopted into the schema. Nothing removed; nothing in cc-settings is made redundant by 2.1.139. All other 2.1.139 additions are native CLI/TUI features (`claude agents`, `/goal`, `/scroll-speed`, `claude plugin details`, transcript navigation) or runtime behavior (MCP `CLAUDE_PROJECT_DIR`, `/mcp` reconnect, compaction prompt) with no cc-settings surface to update.

**Adopted:**

- `CommandHook.args: string[]` — exec form. When set, CC spawns `command` directly with this argv instead of via a shell. Safer for paths with spaces; removes shell-quoting from `command`. (upstream 2.1.139.) Added to `src/schemas/hooks.ts` and documented in `docs/hooks-reference.md`.
- `HookCommon.continueOnBlock: boolean` — PostToolUse-only. When the hook returns a block signal, the turn continues anyway (the block surfaces in context but doesn't abort). Use for soft warnings. (upstream 2.1.139.) Added to `src/schemas/hooks.ts` and documented in `docs/hooks-reference.md`.

**Deletions / Native-now-redundant:**

- None.

**Files changed:**

- `src/schemas/hooks.ts`
- `docs/hooks-reference.md`
- `upstream/claude-code-manifest.json`
- `src/setup.ts`
- `CHANGELOG.md`

## [11.0.0] — 2026-05-11

### refactor: drop pinchtab, single browser-automation surface (chrome-devtools MCP)

Major version bump because this removes a published skill (`/pinchtab`) and an installed CLI dependency. The browser-automation surface is now exclusively the `chrome-devtools` MCP server, which is richer (CDP, perf traces, network, console, lighthouse, screenshots, a11y snapshots, clicks, fills) and integrates with `ENABLE_TOOL_SEARCH` so its descriptions don't burn context when idle.

**What changed**

- **`skills/pinchtab/` deleted** — the `/pinchtab` slash command no longer exists. Skill count 39 → 38.
- **`src/setup.ts`** — removed `npm i -g pinchtab` from `installDependencies`. Fresh installs no longer touch global npm for this.
- **`config/30-permissions.json`** — dropped `Bash(pinchtab:*)` allow rule.
- **`skills/qa/SKILL.md`** — rewritten to call `mcp__chrome-devtools__*` tools (navigate_page, take_snapshot, take_screenshot, click, fill, hover, press_key, resize_page, evaluate_script). Workflow + tool cheat-sheet updated.
- **`skills/figma/SKILL.md`** — removed the Figma desktop CDP integration (brittle, required `--remote-debugging-port` and a separate pinchtab profile). Figma MCP remains the canonical interface for design data; chrome-devtools MCP screenshots the running implementation only. Documented the deliberate choice ("Figma MCP is the canonical Figma interface — don't screenshot it").
- **`skills/lighthouse/SKILL.md`** — visual-regression and baseline screenshots now use `mcp__chrome-devtools__take_screenshot` instead of `pinchtab screenshot`. The `lighthouse` CLI is still required (for the batched 3×3 averaged audit protocol); the MCP server's `lighthouse_audit` is a quicker alternative for ad-hoc runs.
- **`agents/tester.md`** — E2E section rewritten: testing stack now lists `chrome-devtools MCP` in place of `pinchtab (E2E/visual tests)`. Both pinchtab blocks (testing-stack list + workflow example) converted to MCP tool calls.
- **`hooks/verification-check.md`** — "UI Screenshot" verification step references `mcp__chrome-devtools__take_screenshot`.
- **`rules/accessibility.md`** — "Tools" section references `mcp__chrome-devtools__take_snapshot` (text-based a11y tree) instead of `pinchtab snap`.
- **`profiles/webgl.md`** — Visual QA row points at `/qa` (chrome-devtools MCP).
- **`src/scripts/post-edit.ts`** — post-edit hint updated to "Run /qa to validate via chrome-devtools MCP".
- **`tests/install-e2e.test.ts`** — `CC_SKIP_DEPS=1` comment no longer mentions pinchtab.
- **Doc tables** — `MANUAL.md`, `README.md`, `USAGE.md`, `skills/README.md`, `docs/settings-reference.md`, `docs/frontmatter-reference.md` (skill listings, `Bash(pinchtab:*)` permission line, "Skills using `fork`" list, "All Skills" table row) all cleaned of `/pinchtab` references.

**Migration for existing users**

Re-run `setup.sh` (or `/cc-update`). The installer overwrites `~/.claude/` from the repo, so `skills/pinchtab/` will be removed on next install. The global `pinchtab` npm package will linger on your machine — uninstall it manually with `npm uninstall -g pinchtab` if you want it gone. Existing prompts that reach for `/pinchtab` should now reach for `/qa` (structured review) or call `mcp__chrome-devtools__*` tools directly.

### refactor: compress 38 skill descriptions (8072 → 6732 chars, −17%)

The Skill tool's selector reads every skill description into context on every turn. Trimming the description budget reduces per-session overhead. **No trigger keywords were removed** — only redundant prose, "formerly /X" breadcrumbs that have moved to skill bodies, and over-qualified "for Y use /Z" notes that the model can infer from context.

Top compressions:

| Skill | Before | After | Δ |
|---|---|---|---|
| create-handoff | 365 | 233 | -132 |
| orchestrate | 363 | 227 | -136 |
| checkpoint | 350 | 246 | -104 |
| explore | 336 | 235 | -101 |
| compare-approaches | 294 | 248 | -46 |
| qa | 282 | 234 | -48 |
| long-task | 291 | 207 | -84 |
| build | 261 | 199 | -62 |

20 other skills got smaller per-description reductions. The 5 shortest (lenis, init, ship, ask, refactor) were already lean — left alone.

### docs: MCP `_status` audit

Phase 3 of the rebuild. Audited every server's `_status: core` claim against actual usage in shipped skills/agents/hooks/rules/docs. **All 4 servers in `config/20-mcp.json` are correctly classified:** `chrome-devtools` (59 refs after the pinchtab drop), `tldr` (38), `context7` (8), `figma` (4). The 5th server in `mcp-configs/recommended.json` (Sanity) is `core` despite 0 references in shipped code — but Sanity is a Darkroom stack baseline (per-user auth means it lives in `~/.claude.json`, not the shipped MCP config), so the classification is correct. **No reclassifications needed.**

### refactor: profile shrink evaluated, declined

Phase 2 of the rebuild was to extract a `profiles/_base.md` from the 5 stack profiles. Delegated to an implementer agent; the agent's honest report: profiles share almost no verbatim content (only ~15 lines of true overlap between nextjs.md and react-router.md). A `_base.md` extraction would net **+51 total lines** for marginal abstraction value. Decision: do not extract. Re-evaluate if a 6th profile is added or if real overlap accumulates.

### What v11.0.0 doesn't change

- All zod schemas — unchanged
- All agents (except tester.md content edit) — unchanged
- All hooks (except verification-check.md content edit) — unchanged
- All MCP server configs (except dropping pinchtab references) — unchanged

**Files changed (30):**

- `skills/pinchtab/SKILL.md` (deleted)
- `skills/{qa,figma,lighthouse}/SKILL.md` (rewritten to use chrome-devtools MCP)
- `skills/{create-handoff,orchestrate,checkpoint,explore,compare-approaches,long-task,qa,build,figma,cc-sync,cc-update,autoresearch,project,context-doc,consolidate,docs,learn,verify,tdd,write-a-skill,tldr}/SKILL.md` (description compression)
- `src/setup.ts` (removed pinchtab install; VERSION 10.13.0 → 11.0.0)
- `src/scripts/post-edit.ts` (post-edit hint)
- `config/30-permissions.json` (dropped pinchtab Bash rule)
- `agents/tester.md` (E2E section rewritten)
- `hooks/verification-check.md` (UI Screenshot row)
- `rules/accessibility.md` (Tools list)
- `profiles/webgl.md` (Favored Tools row)
- `tests/install-e2e.test.ts` (CC_SKIP_DEPS comment)
- `MANUAL.md`, `README.md`, `USAGE.md`, `skills/README.md`, `docs/settings-reference.md`, `docs/frontmatter-reference.md` (table + listing updates)
- `CHANGELOG.md`

## [10.13.0] — 2026-05-11

### refactor: skill consolidation — 42 → 39 skills, 3 renames, 5 trigger tightenings

Post-congruence audit (via `/consolidate`) found three skills that were stubs or duplicates of existing capabilities, three names that obscured their function, and five trigger-keyword collisions. All actioned. **Behavior preserved everywhere** — every removed or renamed skill's functionality lives on under a different name, with backward-compatibility breadcrumbs in MANUAL.md / README.md / SKILL.md descriptions.

**Drops / merges (4 → 1 skill removed, 3 folded into siblings):**

- `audit` — broken YAML (`description: |` with no value). Description rewritten to a single line clarifying it's slash-only.
- `teams` — **merged into `orchestrate`**. The 22-line stub was a parallel-fan-out specialization of the same `maestro` delegation. Body folded into a "When to Fan Out (Teams mode)" section in `orchestrate/SKILL.md`. Triggers migrated.
- `zoom-out` — **merged into `explore`**. Self-described as "Counter to /explore" — it was a focused mode, not a separate skill. Body folded into an "Upward-zoom mode" section in `explore/SKILL.md`. Triggers migrated.
- `context` — **runbook folded into `create-handoff`**. Trigger "compact" collided with the native `/compact` command; "context window" / "running out of context" triggers moved to `create-handoff`. The full context-window runbook (statusline thresholds, model degradation table, structured compaction template, post-compaction validation, proactive reduction tips) is now a final section in `create-handoff/SKILL.md`.

**Renames (3) — names now match function:**

- `f-thread` → `compare-approaches` — `f-thread` was a Darkroom-internal label. New name is self-documenting and matches the trigger phrases.
- `l-thread` → `long-task` — same opacity problem. New name distinguishes from the `t*` cluster (`tldr`/`teams`/`tdd`/`test`) it used to crowd into alphabetically.
- `debug` → `pinchtab` — the skill is not general debugging, it's a wrapper around the `pinchtab` CLI. The misleading name was stealing invocations from `/fix` via the "bug"/"broken" trigger words.

**Trigger tightening (5) — eliminates collisions:**

- `build` — removed the word "component" from the description (it was stealing from `/component`)
- `pinchtab` (was `debug`) — dropped generic "bug"/"broken" terms; restricted to visual/UI/E2E
- `qa` — dropped "validate" (now reserved for `/verify`); lead with "Visual + a11y QA"
- `checkpoint` — clarified scope to **mid-task rollback before risky operations**; moved "save progress" out
- `create-handoff` — leads with **end-of-session boundary**; absorbs context-window triggers from former `/context`

**Inbound references updated (no broken links):**

- `agents/maestro.md` — FBPCL framework lines now reference `/compare-approaches` and `/long-task`
- `agents/planner.md`, `agents/security-reviewer.md`, `rules/ui-skills.md` — paths to relocated reference docs (carried over from v10.12.1)
- `docs/thread-types.md` — skill file paths updated
- `docs/frontmatter-reference.md` — `fork`/`inherit` skill lists, agent-delegation table, "All Skills" table
- `hooks/README.md` — checkpoint.md / verification-check.md cross-references
- `MANUAL.md`, `USAGE.md`, `README.md`, `skills/README.md` — all trigger tables, slash command references, and prose mentions

**Conceptual names preserved:** `docs/thread-types.md` retains "F-Thread" and "L-Thread" as section headers — these are the FBPCL framework categories (Fusion / Long-duration), distinct from the slash command names. Only the implementation pointers (`See: skills/.../SKILL.md`) were updated.

**Result:** 42 → 39 skills. No functionality lost; every former skill has either a renamed home or a fold-in target with its triggers preserved.

**Files changed (16):**

- `skills/audit/SKILL.md` (YAML fix)
- `skills/orchestrate/SKILL.md` (teams folded in)
- `skills/explore/SKILL.md` (zoom-out folded in)
- `skills/create-handoff/SKILL.md` (context runbook folded in)
- `skills/teams/SKILL.md` (deleted)
- `skills/zoom-out/SKILL.md` (deleted)
- `skills/context/SKILL.md` (deleted)
- `skills/f-thread/` → `skills/compare-approaches/` (renamed + frontmatter updated)
- `skills/l-thread/` → `skills/long-task/` (renamed + frontmatter updated)
- `skills/debug/` → `skills/pinchtab/` (renamed + frontmatter + clarifying body)
- `skills/build/SKILL.md` (trigger tightening)
- `skills/qa/SKILL.md` (trigger tightening)
- `skills/checkpoint/SKILL.md` (trigger tightening)
- `agents/maestro.md` (FBPCL slash-command refs)
- `docs/thread-types.md` (skill file paths)
- `docs/frontmatter-reference.md` (three tables)
- `hooks/README.md`, `skills/README.md`, `MANUAL.md`, `USAGE.md`, `README.md` (skill listings + trigger tables)
- `src/setup.ts` (VERSION 10.12.1 → 10.13.0)
- `CHANGELOG.md`

## [10.12.1] — 2026-05-11

### docs: document 13 schema keys + relocate reference docs to docs/

Post-sync congruence pass surfaced two pre-existing gaps that predated v10.12.0:

**docs/settings-reference.md** — 13 keys from `src/schemas/settings.ts` had no dedicated section. Added concise sections (each with a `json` snippet) for:

- `showThinkingSummaries`, `autoScrollEnabled`, `changelogUrl`
- `disableAllHooks`, `disableAutoMode`, `disableBypassPermissionsMode`, `disableSkillShellExecution`, `disableDeepLinkRegistration`
- `channelsEnabled` / `allowedChannelPlugins` (paired)
- `allowedMcpServers` / `deniedMcpServers` (paired)
- `feedbackSurveyRate`

Documentation now matches schema 1:1 — every top-level key in `Settings` (zod) has either a dedicated `### key` section or is the subject of a top-level section (Permissions, MCP Server Configuration, Hook Configuration).

**Reference docs relocated** — four `.md` files that lived at the root of `skills/` were not skills; they were reference material that `agents/*.md` and `rules/*.md` linked to. Moved to `docs/` where reference docs belong, since `skills/` is for `<name>/SKILL.md` directories used by the Skill tool:

- `skills/accessibility.md` → `docs/accessibility.md`
- `skills/architecture-reference.md` → `docs/architecture-reference.md`
- `skills/security-reference.md` → `docs/security-reference.md`
- `skills/seo-reference.md` → `docs/seo-reference.md`

Inbound references updated atomically in `rules/ui-skills.md`, `agents/planner.md`, `agents/security-reviewer.md`. Files are still copied to `~/.claude/docs/` by `installConfigFiles` (which iterates `["agents", "skills", "profiles", "rules", "contexts", "hooks", "docs"]`) — no installer change required, only the relative path in the inbound references.

**Files changed:**

- `docs/settings-reference.md` (13 new `###` sections inserted before `## Permissions`)
- `docs/accessibility.md` (moved from `skills/`)
- `docs/architecture-reference.md` (moved from `skills/`)
- `docs/security-reference.md` (moved from `skills/`)
- `docs/seo-reference.md` (moved from `skills/`)
- `rules/ui-skills.md` (path update)
- `agents/planner.md` (path update)
- `agents/security-reviewer.md` (path update)
- `src/setup.ts` (VERSION 10.12.0 → 10.12.1)
- `CHANGELOG.md`

## [10.12.0] — 2026-05-11

### feat: sync upstream to Claude Code 2.1.138 — 3 new top-level settings, 6 new env vars

Upstream 2.1.129 → 2.1.138 ships three new top-level settings, a new permissions-nested array, two new sandbox path overrides, six new env vars, and a new hook JSON input field. The rest of the ~80 upstream entries in this range are bug fixes that don't overlap with cc-settings hooks, scripts, or schemas — no dedupe required.

**Adopted (schema):**

- `worktree.baseRef` (v2.1.133) — `fresh` | `head` chooses whether `--worktree`, `EnterWorktree`, and agent-isolation worktrees branch from `origin/<default>` (`fresh`, the new default) or local `HEAD` (`head`). The new default **reverts** the 2.1.128 change we tracked in v10.11.2 — `EnterWorktree`'s base went `origin/<default>` → local HEAD in 2.1.128, then back to `origin/<default>` in 2.1.133. Users who relied on the 2.1.128 behavior (carrying unpushed commits into worktrees) should set `worktree.baseRef: "head"` explicitly. `src/schemas/settings.ts` extends the existing `worktree` block with a strict `baseRef` enum.
- `skillOverrides` (v2.1.129) — per-skill record, `off` | `user-invocable-only` | `name-only`. Previously documented but non-functional; the v2.1.129 bug fix made it real. `src/schemas/settings.ts` adds a strict `z.record(string, enum)`.
- `parentSettingsBehavior` (v2.1.133, admin-tier) — `'first-wins' | 'merge'` for SDK `managedSettings` policy participation. `src/schemas/settings.ts` adds a strict enum.
- `permissions.autoMode.hard_deny` (v2.1.136) — array of permission rules that block unconditionally regardless of user intent or allow exceptions. `src/schemas/permissions.ts` `AutoModeConfig` now documents the field; the existing `.passthrough()` already accepted it at install time, but now editor IntelliSense surfaces it.
- `sandbox.bwrapPath` / `sandbox.socatPath` (v2.1.133) — Linux/WSL managed overrides for bubblewrap and socat binary locations. `src/schemas/settings.ts` `Sandbox` documents both; passthrough already accepted them.

**Adopted (manifest):**

- `upstream/claude-code-manifest.json` — `claudeCodeVersion` 2.1.128 → 2.1.138, `lastScan` 2026-05-11.
- `knownSettingsKeys` += `parentSettingsBehavior`, `skillOverrides`, `worktree`.
- `knownEnvVars` += `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN`, `CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL`, `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`, `CLAUDE_CODE_FORCE_SYNC_OUTPUT`, `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE`, `CLAUDE_CODE_SESSION_ID`.

**Adopted (docs):**

- `docs/settings-reference.md` — env table gains the 6 new env vars (with version annotations), `sandbox` table gains `bwrapPath`/`socatPath`, `worktree` section gains `baseRef`, new sections `skillOverrides`/`parentSettingsBehavior`, and a new `permissions.autoMode` subsection documents `hard_deny`.
- `docs/hooks-reference.md` — `$CLAUDE_EFFORT` env var is now exposed to Bash subprocesses and to hook scripts; JSON input gains `effort.level` (v2.1.133). New "Effort Level in JSON Input" subsection.

**Deletions / Native-now-redundant:** none. None of the 2.1.129 → 2.1.138 fixes overlap with cc-settings workarounds — the upstream `Bash(mkdir *)` / `Bash(touch *)` allow-rule fix (v2.1.129) honors patterns we already had in `config/30-permissions.json` without any change on our side.

**Skipped (notable):** VS Code activation fix (2.1.137), VS Code/Mantle gateway fixes (2.1.131), ~50 bug fixes in 2.1.136 (login race, MCP OAuth refresh, plan-mode Edit allow rule, `/usage`, plugin slugs, BG color artifacts, etc.), 2.1.133 misc fixes (parallel 401, drive-root rules, mapped drives, subagent skill discovery, etc.), 2.1.132 misc fixes (SIGINT, surrogates, paste, vim NFD, fullscreen sleep/wake, MCP stdio runaway, Bedrock 400), 2.1.129 CLI flags (`--plugin-url`) and plugin manifest `themes`/`monitors` reorg (cc-settings ships no plugin manifest).

**Files changed:**

- `src/schemas/settings.ts` (new fields: `worktree`, `skillOverrides`, `parentSettingsBehavior`, `Sandbox.bwrapPath`, `Sandbox.socatPath`)
- `src/schemas/permissions.ts` (new field: `AutoModeConfig.hard_deny`)
- `upstream/claude-code-manifest.json` (version + scan date + 3 settings keys + 6 env vars)
- `docs/settings-reference.md`
- `docs/hooks-reference.md`
- `src/setup.ts` (VERSION 10.11.2 → 10.12.0)
- `CHANGELOG.md`

## [10.11.2] — 2026-05-05

### chore: sync upstream tracking to Claude Code 2.1.128 (no schema impact)

Tracking-only sync. Upstream 2.1.128 is overwhelmingly bug fixes (30+) plus a handful of small UX/CLI changes. None require schema changes, hook event additions, or new env var tracking. (2.1.127 was skipped upstream.)

**Adopted:** none — no new schema-relevant surface area.

**Deletions / Native-now-redundant:** none — nothing in cc-settings is subsumed by 2.1.128.

**Notable upstream changes (no cc-settings impact, recorded for reference):**

- `--channels` now works with console (API key) auth; managed-settings orgs must set `channelsEnabled: true`. Schema comment on `src/schemas/settings.ts` `channelsEnabled` updated to note this.
- MCP: `workspace` is now a reserved server name. Verified no shipped cc-settings MCP config (`config/20-mcp.json`, `mcp-configs/`) uses that name.
- Subprocesses (Bash, hooks, MCP, LSP) no longer inherit `OTEL_*` env vars. cc-settings already exposes the related `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` knob; no change needed.
- `EnterWorktree` now creates branches from local HEAD as documented (was branching from `origin/<default>`). cc-settings does not invoke this tool from any skill or hook; only `skills/cc-update/SKILL.md` references `origin/main`, and that is for our own update flow, unrelated.
- ~25 other bug fixes (focus mode, OSC 9 desktop notification, drag-drop, fenced-code-block clipboard whitespace, vim NORMAL-mode `Space`, Bedrock default-model prefix, parallel shell tool calls, sub-agent prompt caching, etc.) — all bug fixes with no cc-settings overlap.

**Manifest:** `upstream/claude-code-manifest.json` bumped (claudeCodeVersion `2.1.126` → `2.1.128`, lastScan `2026-05-05`). No additions to `knownSettingsKeys`, `knownHookEvents`, `knownHookTypes`, `knownEnvVars`, `knownPermissionModes`, `knownMcpTransports`, or `knownBuiltinTools`.

**Files changed:**

- `upstream/claude-code-manifest.json`
- `src/schemas/settings.ts` (comment only)
- `src/setup.ts` (VERSION bump)
- `CHANGELOG.md`

## [10.11.1] — 2026-05-04

### fix: `$schema` must be the schemastore URL — Claude Code skips the entire settings.json otherwise

Clean installs were silently losing every setting (env vars, statusLine, hooks, permissions) because `config/10-core.json` declared `$schema` as `https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/schemas/settings.schema.json` — the cc-settings extended schema. Claude Code's settings validator only accepts `https://json.schemastore.org/claude-code-settings.json` and skips the whole file on any other value. Symptom in the wild: a clean install of Claude + cmux + cc-settings produced an empty statusline and a "Settings Error" banner.

Fixed by switching `config/10-core.json` to the canonical schemastore URL. cc-settings's own extended schemas (`agent.schema.json`, `hooks-config.schema.json`, `skill.schema.json`, `claude-json.schema.json`) remain published and used for *non-settings* files, where editor IntelliSense isn't gated by Claude Code's runtime check. `docs/settings-reference.md` updated to document the constraint so the broken pattern doesn't get re-copied.

## [10.11.0] — 2026-05-04

### feat: MCP servers — `_status: core | optional` annotation; install summary groups by status

A new team member could install cc-settings, see 5 MCP servers in `~/.claude.json`, and have no way to tell which were the team baseline vs which were the previous owner's preferences. The `_status` annotation closes that.

**Schema** — `src/schemas/mcp.ts` `_status` field changed from `"installed" | "optional"` to `"core" | "optional"`. Existing values renamed for clarity (`installed` was ambiguous — installed by whom, into what).

**Configs annotated:**

- `config/20-mcp.json` — every shipped server (`context7`, `tldr`, `figma`, `chrome-devtools`) now declares `_status: "core"`.
- `mcp-configs/recommended.json` — every server in `mcpServers` (5) is `core`; every server in `optionalMcpServers` (3) is `optional`.

**Install-summary surface** (`src/setup.ts` `showSummary`):

```
MCP servers in ~/.claude.json:
  core:
    - context7
    - tldr
    - figma
    - chrome-devtools
    - Sanity
  optional (manually added):
    - github
  user-added:
    - my-internal-server
```

The three buckets — `core`, `optional`, `user-added` (no `_status` field) — make it obvious which servers came from cc-settings, which the user added from the optional list, and which are the user's own (custom team-internal MCPs etc.).

**MANUAL.md** — new "MCP servers (core vs optional)" section under "Advanced". Tables enumerate each core server's purpose + which skill(s) use it, and each optional server's "why optional" rationale.

**Files changed:**

- `src/schemas/mcp.ts` — `_status` enum updated, comment block explaining the field.
- `config/20-mcp.json` — `_status: "core"` on all 4 servers.
- `mcp-configs/recommended.json` — renamed `installed` → `core`, added `optional` to the 3 optionalMcpServers entries.
- `src/setup.ts` — `showSummary` now groups MCP servers by `_status` (3 buckets).
- `MANUAL.md` — new MCP servers section.
- `schemas/{skill,agent,claude-json}.schema.json` — regenerated.
- `src/setup.ts` — `VERSION` 10.10.3 → 10.11.0.

## [10.10.3] — 2026-05-04

### ci: dedicated install-e2e + bash-bootstrap jobs

CI's `test` matrix already runs `tests/install-e2e.test.ts` on `ubuntu-latest` / `macos-latest` / `windows-latest` — install failures were technically caught, just buried among 240+ unrelated tests. Two new jobs surface them as their own PR checks:

- **`install-e2e`** (Ubuntu + macOS) — runs `tests/install-e2e.test.ts` and `tests/golden-migrations.test.ts` in isolation. Fastest signal when an install regression lands.
- **`install-bash-bootstrap`** (Ubuntu + macOS) — runs `bash setup.sh --dry-run` to validate the bootstrap path itself (the bash wrapper that ensures Bun is installed before exec'ing `bun src/setup.ts`). Catches bash-specific bugs that the direct-bun path misses.

Windows is excluded from both — it goes through `setup.ps1`, which has its own (currently untested) bootstrap and its own escape hatches. Closing that gap is a separate task tracked in `docs/migration-coexistence.md`.

**Files changed:**

- `.github/workflows/ci.yml` — two new jobs added.
- `src/setup.ts` — `VERSION` 10.10.2 → 10.10.3.

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
