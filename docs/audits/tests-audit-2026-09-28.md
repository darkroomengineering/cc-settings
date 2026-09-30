# Tests audit, 2026-09-28

First run of `/audit tests` (v15.37.0) on cc-settings. Scope: 94 files in `tests/`, 33,392 lines, split into four read-only lanes. Coverage was uneven: lanes read about 60 files in full and skimmed the rest by test name plus excerpts, including the two largest (`codex-install.test.ts`, `install-e2e.test.ts`). A file with no finding below is not cleared.

**Verdict:** the suite is mostly contract tests. The checklist found 17 confirmed low-value tests totalling about 480 test lines (under 1.5% of the suite), no freed production code beyond one test-only `export`, and two real coverage gaps worth more than the deletions.

## Summary

| ID | Sev | Pattern | Test | Remedy | ~LOC |
|---|---|---|---|---|---|
| G1 | H | gap | `hooks-fingerprint.test.ts:287` | Nothing reaches `fingerprintSettingsHooks` (`src/lib/claude-install-settings.ts:178`); the test beside it asserts zod stripping instead. Add a behavioral test of the fingerprint the installer actually writes. | +20 |
| G2 | M | gap | `claude-bridge.test.ts:78` | "never puts the prompt on argv" checks a function that takes no prompt. Replace with a test that the prompt reaches `claude -p` through stdin. | ±0 |
| T6-1 | M | T6 | `context-continuity-gaps.test.ts` (whole file) | G2/G3 duplicate `session-continuity.test.ts:237`, `:124`, `:388`. Fold G1's `source`/`trigger` asserts and G3's placeholder-removal assert into session-continuity, then delete. | -165 |
| T2-1 | M | T2/T6 | `setup.test.ts` (whole file) | Tests only zod on `Settings.safeParse`; test 1 asserts the input it built. Covered by `schemas.test.ts:36-79`. Header claims `installSettings` is internal; it is exported. | -65 |
| T6-2 | L | T6 | `scripts-smoke.test.ts:417-449` | Duplicates `check-docs-before-install.test.ts`. Move the empty-command case, delete the rest. | -30 |
| T6-3 | L | T6 | `light-profile.test.ts:93-116` | Five "X is dropped" tests restate `:76` (exact key list). | -24 |
| T1-1 | L | T1 | `plugin-manifest.test.ts:192` | Loops `.mcp.json` stdio servers; there are none, so no assertion runs. `:191` exact-equality already fails on any new server. | -15 |
| T7-1 | L | T7 | `codex.test.ts:132-175` | `classifyCodexError` re-tests `sanitizeOutput` redaction owned at `:341-408`. Keep one wiring case and the 200-char cap; move the short-`sk-` case to the owner. | -30 |
| T7-2 | L | T7 | `version-delta.test.ts:34-79` | `readInstalledVersion` is a one-line wrapper; three of four cases mirror `version-drift.test.ts`. Keep "version field missing". | -25 |
| T6-4 | L | T6 | `scripts-smoke.test.ts:527-547` | log-bash "echo hello" covered by `:549` and `log-bash.test.ts:78`. | -20 |
| T15-1 | L | T15 | `install-e2e.test.ts:1340` | "prints version-delta" never checks a delta; costs ~90s timeout budget. Fold its one unique assert into an existing reinstall test. | -17 |
| T6-5 | L | T6 | `permissions-check.test.ts:242`, `:263` | Same input class as `:217` and `:279`. | -14 |
| T6-6 | L | T6 | `team-knowledge.test.ts:45` | Same input and asserts as `:75`. | -13 |
| T6-7 | L | T6 | `lint-knowledge.test.ts:76` | Covered by `:41` and the multi-note tests at `:233`, `:251`. | -12 |
| T6-8 | L | T6 | `checkpoint.test.ts:141` | `list` exit 0 covered by `:148`. | -9 |
| T3-1 | L | T3/T13 | `light-profile.test.ts:22-28` | Copies `LIGHT_SKILLS`; covered by install-e2e light test and `lib-helpers.test.ts:296`. Keep `:30`. | -8 |
| T13-1 | L | T13/T8 | `plugin-key-redaction.test.ts:19` | Asserts a constant contains its own literal; unexport `LATER_KEY_COMMAND`. | -4 |
| T6-9 | L | T6 | `profile-schema.test.ts:57` | Same regex failure as `:52`. | -4 |

## Plausible (a field is missing; do not delete yet)

- **T4, replace before deleting:** `install-e2e.test.ts:1162` (empty-archive branch has no behavioral test), `:1154` and `:634` (frozen-lockfile flags; supply-chain invariant, retention bar likely keeps them), `pre-push-proof.test.ts:169` (exact `Bun.spawn(...)` text; a `PATH=""` behavioral test would replace it), `hook-fail-open.test.ts:93` (`try {` presence does not prove fail-open), `plugin-manifest.test.ts:589`.
- **T8:** `tsc-lib.test.ts:41`, where `incremental:false` may be reachable only from the test. Check the cache-retry path first.
- **T14/T15:** `review-queue.test.ts:390` passes whether or not the `movesHead` branch fires. Better replaced with a real HEAD-advance case.
- **T3:** `knowledge-hint.test.ts:49-68` copies `GENERIC_TOKENS`; replace with one `scoreNote` case covering the untested tokens.
- **T6/T10:** `schedule.test.ts:16-80` re-derives `decideAutoUpdate` in its matrix; the named security cases duplicate cells. Keep the named cases, and trim the matrix only once there's an independent oracle.
- **Small T6 clusters** (3–10 LOC each, origin unchecked): `agent-schema.test.ts:31,51,71`, `codemap.test.ts:198-244` (fold into one table), `knowledge-index.test.ts:27,96,101`, `status.test.ts:189`, `compaction-trigger.test.ts:71`, `redact.test.ts` MY_TOKEN/GITHUB_SECRET, `hooks-fingerprint.test.ts:69`, `schemas.test.ts:120`, `install-display.test.ts:86`.
- **Rename only:** `settings-merge.test.ts:1248` says the schema is `.strict()`; it is loose. The test guards a real forward-compat contract, so keep it and fix the name.

## Considered and rejected

The retention bar kept these tests. They look like junk patterns but each guards a contract:

- **Security and permissions:** `safety-net` tables, `permissions-check` precedence, `pre-push-proof` shell splitting, `audit-hooks` pattern self-tests.
- **Migration:** `DEPRECATED_COMMAND_PATTERNS`, `permissionRuleIsDeprecated`, golden migrations.
- **Shipped artifacts:** version sync across the 4 sites, byte budgets, emitted schemas, `docs-permissions` freshness, runtime manifest closure, pinned tool checksums.
- **Data-loss guards:** output-style preservation, backup tamper checks, install lock.
- **`docs-settings-keys`:** it looks like a copied inventory, but it's the only thing keeping the docs table in sync with the schema.

## Stale comments found in passing

- `claude-install-settings.ts:174-176` ends mid-sentence ("The").
- `codex-install.test.ts:3868` calls PATH a boot-time snapshot; `whichCommand` reads the live PATH.
- `setup.test.ts` header says `installSettings()` is internal; it is exported.

## Follow-up (15.37.1)

G1, G2 and 14 findings were applied. Three findings were wrong and were not applied:

- **T6-7** `lint-knowledge.test.ts:76`: the tests cited at `:233` and `:251` are not multi-note tests, and no other test asserts `noteCount` on a multi-note dir. Kept.
- **T6-8** `checkpoint.test.ts:141`: `:148` asserts `list` stdout but never its exit code. Kept.
- **Stale comment** `codex-install.test.ts:3868`: the comment is correct. `Bun.spawn` resolves a bare command against the PATH the process started with; the G2 test had to spawn a child process for exactly that reason.

The lesson for the checklist: the "stronger test already covering it" field needs the covering test's actual assertion quoted, not its line number.

## Checklist calibration

- **T6 (duplicate contract)** produced most of the confirmed findings. **T4 (source grep)** produced mostly PLAUSIBLE, because this repo's greps often guard byte-level supply-chain invariants.
- **Not triggered:** T5, T9, T11 and T12 produced no confirmed findings here. The main test for those patterns is running this audit on a client app with a mock-heavy Vitest suite.
- **Missed by skimming:** a reader that only skims a file misses T6 duplicates in large files. A future run should split `codex-install.test.ts` and `install-e2e.test.ts` into their own lanes.
