# Nuclear Review — Whole-Codebase Maintainability Audit

- **Repo:** cc-settings @ `aa51f27` (main)
- **Date:** 2026-07-20
- **Method:** Phase 0 inline map → 3 parallel structural reviewers (installer core / hooks+scripts / schemas+codemap, full reads) → context7 dependency audit → Codex cross-model pass (completed cleanly this time; 6 findings) → team-knowledge reconciliation → synthesis. Baseline: the 2026-07-08 adversarial audit's 56 findings, all remediated in PR #127 — none re-litigated; several fixes spot-verified as held.
- **Result:** 17 findings — 1 high / 8 medium / 8 low. 16 CONFIRMED, 1 PLAUSIBLE. No file exceeds 1000 lines. No By-Design escalations.

## Verdict

**NEEDS RESTRUCTURING (targeted)** — the mildest form. The codebase is leaner than most of its class: merge logic was already consolidated once (`merge-keyed.ts`), artifact mechanics already extracted (`artifact-store.ts`), frontmatter parsing already shared (`lint-frontmatter.ts`), and all three reviewers independently reported "the code-judo move I was hunting for is already done" in at least one spot. What blocks a CLEAN verdict: one genuinely dead abstraction with an actively misleading JSDoc sitting in the largest file (N1), a dependency one major behind in exactly the spot where the new major's headline win applies (N3), and a cluster of small, mechanical duplications — the *formatting/reporting* and *ignore-set* layers that the repo's own extraction habit skipped. Roughly one to two days of consolidation, no rework.

## Code-Judo Opportunities

### N1 (high, CONFIRMED) — `buildInstallPlan` is a single-source-of-truth for almost nothing: delete it
`src/setup.ts:119-222`, consumed only at `setup.ts:432`. Its JSDoc claims three consumers (installConfigFiles, cmdDryRun, showSummary); the call graph shows exactly one. `cmdDryRun`/`showSummary` build their own tables from `LIGHT_SKILLS`/`PROFILE_MANIFEST` and never touch it. The full-profile branch (~25 lines) is dead; the light-profile *copy* steps are dead too (installConfigFiles rebuilds its own set); only the light-profile **prune** computation (~35 lines) does real work — through a needlessly generic `InstallStep[]` shape whose `action` discriminant no caller branches on.
**Fix:** delete `buildInstallPlan` + `InstallStep`; move the prune computation to `light-profile.ts` next to `PROFILE_MANIFEST` as `lightProfilePruneTargets(sourceDir): string[]`. (Supersedes Codex's softer "make the profile branching data-driven" — the evidence supports deletion, not unification.)

### N8 (medium, CONFIRMED — Claude+Codex convergent) — codemap's public surface is defined twice and tested zero times
`src/codemap/mcp-server.ts:59` (`SUPPORTED` table + `UNSUPPORTED` list + dispatch) vs `src/codemap/cli.ts:51-88` (independent verb switch over the same commands). A tool added in one silently goes missing in the other — and nothing would catch it: `tests/codemap.test.ts` covers only 4 of the getters; `getArch`, `getTree`, `getCalls`, `getChangeImpact`, the CLI parser, and the entire hand-rolled JSON-RPC framing (`mcp-server.ts:140-257` — the wire protocol a live session speaks when `native-ts` is opted into) have no test.
**Fix:** one shared tool registry (name → schema → handler) generating both the MCP `tools/list`/`tools/call` surface and the CLI dispatch; plus a protocol test piping a `tools/list` + `tools/call` exchange through `mcp-server.ts`. Existence of the module itself is **cleared** — see Considered/Rejected.

### N6 (medium, CONFIRMED) — mtime-sort-and-keep-N pruning implemented three times
`src/scripts/checkpoint.ts:372-411`, `src/scripts/handoff.ts:276-296`, `src/scripts/session-start.ts:73-97` — same algorithm, three hand-rolled copies; `handoff.ts:259-261` even comments that session-start "already does this" without collapsing it. `artifact-store.ts` already owns the adjacent mechanics for the same two callers.
**Fix:** `pruneArtifacts(dir, pattern, keep)` in `artifact-store.ts`; three call sites become a loop + `unlink`.

### N5 (medium, CONFIRMED) — `frontmatter-validate.ts` duplicates the linters' file-discovery pipeline
`src/lib/frontmatter-validate.ts:40-98` (`WALK_SPECS`/`listCandidates`/`validateKind`, wired at `setup.ts:791`) re-implements the walk → parse → schema-validate pipeline that `lintAgentsDir`/`lintSkillsDir`/`lintProfilesDir` already own, on a fully separate call graph validated by separate, unlinked test suites.
**Fix:** have `validateFrontmatters` call the three `lint*Dir` functions and map `findings.filter(f => f.rule === "schema")` — ~60 lines deleted. The intent split (install-time non-fatal vs CI's richer rules) is legitimate and stays; only the discovery mechanics dedupe.

## Structural Blockers

### N2 (medium, CONFIRMED) — `review-queue.json`'s schema lives only in its read-only consumer; the writer trusts a bare cast
`src/hooks/statusline.ts:49-54` validates on read; but `src/lib/review-queue.ts` (where the interface lives) exports no schema, and the file's primary **writer** — `src/hooks/tool-cadence.ts:181-262` — reads it four times via unvalidated `readState<T>` casts, does arithmetic, and persists back. `src/lib/version-delta.ts:250-256` states the repo's own policy: both readers of a state file must validate so corruption degrades to "absent" in every consumer. Scenario: corruption self-heals in the display while tool-cadence compounds garbage counters back to disk.
**Fix:** hoist `ReviewQueueStateSchema` into `review-queue.ts`; `tool-cadence.ts`, `session-start.ts:359`, `review-batch.ts:14` all `.safeParse` through it.

### N4 (medium, PLAUSIBLE) — three hand-maintained "managed footprint" lists (H7-class drift vector)
`src/setup.ts:249-265` (backup candidates), `setup.ts:357-389` (cleanOldConfig wipe targets), `src/lib/light-profile.ts:52-59` (`PROFILE_MANIFEST.full.dirs`) overlap heavily but derive from nothing shared; createBackup's own comment names the incident (H7) this divergence already caused once. Adding a managed dir requires remembering up to three sites.
**Fix:** one `MANAGED_TOP_LEVEL_PATHS` list both backup and wipe iterate, each applying its own granularity.

### N9 (medium, CONFIRMED) — `setup.ts` at 861 lines has a clean, precedented extraction seam
Lines 226-483 (backup/clean/copy phases, ~260 lines) depend only on `sourceDir`/`profile`/`CLAUDE_DIR` — no CLI or merge coupling. The repo already applied this exact pattern twice (`install-cmds.ts`, `install-display.ts` both carry "extracted from src/setup.ts" headers).
**Fix:** extract `src/lib/install-fs.ts`; setup.ts drops to ~600 lines of pure orchestration, well clear of the 1000-line limit it is currently trending toward.

## Dependency Audit (context7)

- **`typescript@6.0.3` → `7.0.2` (N3, medium, CONFIRMED — remediation BLOCKED)** — one full major behind, and the `tsc --noEmit` hook usage is exactly the shape TS 7's Go-native compiler accelerates most. `tsconfig.json` is clean against the 6→7 removal list. **However, the remediation attempt (2026-07-20) surfaced a blocker the audit missed: the audit checked config compatibility but not programmatic API usage.** `src/codemap/` consumes the TypeScript v6 JS compiler API (`ts.isArrowFunction`, `ts.SourceFile`, the `Program` object model), which the TS 7 Go-native package no longer ships — upgrading breaks typecheck in `src/codemap/*` and would break the `native-ts` engine at runtime. Stays on 6.0.3. Unblock paths: codemap adopts the TS 7 API surface, or the compiler API is pinned as a separate aliased dependency (with a story for how end-user machines resolve it).
- **`@biomejs/biome@2.5.0` → `2.5.4` (N17, low)** — patch drift only.
- **`zod@4.4.3`** — current latest; idiomatic v4 usage throughout (`z.looseObject`/`z.strictObject`, no deprecated v3 patterns); 24 importers. Clean.
- **`@types/bun@1.3.14`** — exactly matches the Bun 1.3.14 runtime. Clean.
- No duplicated-role deps; no deletable deps (prior cuts already landed: `yaml` → `Bun.YAML`, `@inquirer/confirm` → `node:readline`).

## Abstraction / Type Cleanup

- **N7 (medium, CONFIRMED — Claude+Codex convergent)** — five byte-identical `format*Findings`/`has*Errors` pairs (`lint-agents.ts:127`, `lint-profiles.ts:108`, `lint-skills.ts:234`, `lint-knowledge.ts:132`, `lint-research.ts:166`) plus five redundant `XSeverity` aliases shadowing `LintSeverity` (`lint-frontmatter.ts:16`). The parsing core was extracted once; the reporting layer never was. Fix: generic `formatLintFindings` + `hasLintErrors` in `lint-frontmatter.ts`.
- **N10 (low, CONFIRMED)** — the `.cc-settings-version` sentinel is read from disk three times sequentially at startup (`setup.ts:778,781,786` via `readInstalledVersion` → `readSentinelInfo`, direct `readSentinelInfo`, and `resolveEngine`'s internal read). Read once, pass down; let `resolveEngine` accept a pre-read `SentinelInfo`.
- **N11 (low, CONFIRMED)** — the NaN-guarded int-parse idiom exists as two private extractions (`hook-config.ts:16` `intEnv`, `review-queue.ts:51` `positiveIntEnv`) and four inline copies (`log-bash.ts:21`, `prune-mcp-auth-cache.ts:33`, `checkpoint.ts:367`, `handoff.ts:270`), each re-explaining the falsy-zero rationale. Export `intEnv` once; add `parseIntArg` for the CLI cases.
- **N12 (low, CONFIRMED — Codex-only, verified)** — `NON_NOTE_FILES` (`knowledge-index.ts:21`, exported) is redeclared verbatim as private `SKIP_FILES` (`lint-knowledge.ts:29`). Import the exported set.
- **N13 (low, CONFIRMED)** — the 3-line `hookSpecificOutput.additionalContext` emit is duplicated across 4 hooks (`tool-cadence.ts:90`, `delegation-detector.ts:65`, `quota-steer.ts:37`, `promote-memory.ts:105`). Add `emitAdditionalContext()` to `hook-runtime.ts`.
- **N14 (low, CONFIRMED)** — `handoff.ts:101-112` runs four git reads sequentially on the **PreCompact** hot path — the file whose own lib comment (`git.ts:6-11`) warns that a hang here "would freeze compaction itself" — while sibling `checkpoint.ts:106-115` already parallelizes the same shape via `Promise.all`.
- **N15 (low, CONFIRMED — downgraded from Codex's medium)** — `COMPOUND_SEP` (`audit-hooks.ts:177`) and `SEGMENT_SPLIT_RE` (`safety-net.ts:517`) are twin separator regexes; the copy is *knowing* (safety-net's comment cites audit-hooks), so drift risk is mitigated, but a shared constant would be strictly better. Codex's "one shared scanner/parser module" over-reaches: the surrounding segmentation mechanics legitimately differ (classification vs destructive-battery + recursion).
- **N16 (low, CONFIRMED — Codex-only, verified)** — `inProjectSourceFiles` is byte-identical in `codemap/callgraph.ts:35` and `codemap/structure.ts:103`. Move to `program.ts`.

## Documented / By-Design (verify still current)

- None. No finding contradicts a documented team-knowledge decision. The `cc-settings-installer-skips-nested-config-defaults` gotcha and `review-queue-drains-on-local-commit` note were checked against the installer and review-queue findings; no conflicts, no reclassifications.

## Considered / Rejected

- **Merge/canonicalization duplication across settings-merge/light-profile/mcp** — already unified behind `merge-keyed.ts` (`canonicalKey`/`unionByKey`/`subtractByKey`/`asRecord`); header documents the prior dup and fix.
- **checkpoint/handoff sharing timestamped-artifact mechanics** — already collapsed onto `artifact-store.ts`; only the prune mechanic (N6) missed the cut.
- **"Collapse all six linters into one generic config-driven linter"** — rejected. `lint-frontmatter.ts` already owns the mechanical core; what remains per-module is genuine non-overlapping domain logic (skill folder rules, knowledge supersedes-links, agent isolation history). Only formatting (N7) and discovery (N5) are unjustified duplication.
- **`src/codemap/` as a redundant second engine** — rejected. ~1,200 lines across 9 files, honestly scoped (descriptor states TS/JS-only, no semantic analysis), dependency-free at the protocol layer, and **not reachable in a default install** (default engine is `llm-tldr`; `native-ts` requires explicit `CC_CODE_INTEL_ENGINE` or a prior sentinel). Upstream `llm-tldr` is abandoned, which strengthens its reason to exist. Its gaps are N8/N16, not existence.
- **Schema-enum/regex duplication recurrence** — rejected; PR #127's fixes verifiably held (`KEBAB_CASE_RE` single-sourced in `frontmatter.ts:17` with 5 importers; effort/model/permission enums single-sourced in `agent.ts`/`permissions.ts`).
- **Type-boundary dirt** — rejected; exactly one `as unknown as` in the audited area (`codemap/program.ts:22`, justified dynamic-import shim), `asRecord()` is itself the canonical boundary helper, and the validate-persisted-state / trust-same-turn-stdin split is deliberate and consistent (sole exception: N2).
- **safety-net's local block flow vs `hook-runtime.blockDecision()`** — justified divergence: audit-log must be written before the `never`-returning exit(2).
- **`audit-hooks` walk vs `iterCommandHooks`** — justified: the auditor needs positional indices that the generator intentionally drops (tested API surface).
- **`upstream/scan.ts`/`version-delta.ts` as over-built** — rejected; scan reuses schema exports rather than re-declaring lists, version-delta's bundling is small and self-justified.
- **`statusline.ts` breadth** — rejected; an observer-pattern status bus with per-segment fail-soft, proportionate to a hot-path aggregator.
- **Args/flag threading through `setup.ts` `main()`** — rejected; early-return waterfall, not a tangle.
- **`migrateOnly` duplicating install phases** — rejected; 2 lines of literal overlap.
- **`installSettings` clone-then-mutate density** — left alone deliberately; every line pins a specific remediated bug (H8/H9), rewriting risks reintroducing them.

## Notes

- **History-in-code tension:** several post-#127 comments cite audit finding IDs ("(H7)", "(H8/H9)") and extraction history ("extracted from src/setup.ts (§1.1)"). The team-knowledge convention `history-belongs-in-git-not-code` says code reads as if the current state is the only state. The incident-ID comments arguably earn their place as constraints ("don't reintroduce this"); the extraction-history headers don't. Worth a light pass when touching those files — not urgent.
- Codex bridge completed cleanly this run (contrast with the 2026-07-08 hang) — the fail-open contingency wasn't needed.
- Convergence summary: Codex and Claude independently flagged the linter-scaffolding duplication and the setup.ts profile area (highest-conviction cluster). Codex-only finds N12/N16 survived manual verification; Codex's #1 (codemap registry) was verified and folded into N8; its #4 was downgraded (N15). Claude-only finds (N1, N2, N4, N6, N10, N11, N13, N14) all carry direct line-level traces.
- Fix routing suggestion: N1+N9+N10 are one installer PR; N2 one small hooks PR; N5+N7+N12 one linter PR; N6+N11+N13+N14 one consolidation PR; N8+N16 one codemap PR; N3+N17 one deps PR. Per the skill's Phase 4, each landing PR owes a `CHANGELOG.md` `[Unreleased]` entry, and the deps PR should re-run `bun run schemas:emit` only if zod surfaces move (they shouldn't).
