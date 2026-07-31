# Nuclear Review — Whole-Codebase Maintainability Audit

- **Repo:** cc-settings @ `2828334` (main), v13.0.0
- **Date:** 2026-07-31
- **Method:** Phase 0 inline map → 4 parallel structural reviewers (install core / hooks / scripts / codemap+schemas+lib) → context7 dependency audit → Codex cross-model pass (completed cleanly, 7 findings) → team-knowledge reconciliation (24 notes, corpus reachable) → self-verification of every headline claim → synthesis.
- **Baseline:** `docs/audits/nuclear-review-2026-07-29.md` (7 findings, all closed). Its Considered/Rejected ledger was honored — nothing in it is re-litigated. Its F5 (TypeScript 6→7, blocked upstream) is **not re-reported**; see Dependency Audit.
- **Result:** 9 findings — 0 high / 5 medium / 4 low. 9 CONFIRMED, 0 PLAUSIBLE-only promoted. No source file exceeds 1000 lines. No By-Design escalations.
- **Remediation (same day):** N1, N2, N3 (sites 1–3), N4, N6, N7, N8 landed. **N5 and N3 site 4 were WITHDRAWN — see Corrections.** Both were disproved by building them: N5's collapse produced a thin wrapper (+28 lines, reverted), and N3 site 4 turned out to be a deliberate narrow reader, not a duplicate. Two of nine findings were wrong; the ledger below records why so they are not re-filed.
- **Baseline health:** 1060 tests pass / 0 fail across 63 files (28.6s). `biome check` clean across 185 files. Zero `any` across every audited module.

## Verdict

**NEEDS RESTRUCTURING (targeted)** — the mildest form, and for a narrower reason than two days ago.

Every finding below is consolidation, not correctness. The repo has no file over 1000 lines, no `any`, no cast-laundered invariants, no duplicated-role dependencies, and a test suite that actually holds the contracts (it disproved this audit's single loudest candidate finding — see Considered/Rejected). The prior audit's 7 findings all landed.

What blocks CLEAN is one recurring shape: **a shared primitive exists, is correct, and is adopted at roughly half its eligible call sites.** `runHook` (7 adopters, 6 hand-rolled), `iterCommandHooks` (1 adopter, 1 hand-rolled walk in the security auditor), `lintFrontmatterCore` (5 CLIs re-typing the same plumbing on top), `downloadAndVerify` (fully adopted — the pattern this audit wants repeated). None of these is a design error; each is an unfinished migration. Roughly one day of consolidation, no rework.

The one genuine defect is N7 — a one-line env-parse bug that silently discards a documented user setting.

## Code-Judo Opportunities

### N1 (medium, CONFIRMED — Claude-convergent, Codex partial dissent) — `runHook` is adopted at 7 sites and hand-rolled at 6; finish the migration

`src/lib/hook-runtime.ts:120-128` exists so no hook reimplements fail-open. Adopters: `codex-verify`, `delegation-detector`, `promote-memory`, `quota-steer`, `tool-cadence`, `ledger-record`, `post-compact`.

Hand-rolled, verified by reading each file's tail:

| File | Shape | Convertible |
|---|---|---|
| `src/hooks/freeze-guard.ts` | `try { await main() } catch {}` | directly → `await runHook(main)` |
| `src/hooks/pre-edit-validate.ts` | `try { await main() } catch {}` | directly |
| `src/scripts/session-title.ts` | `try { await main() } catch {}` | directly |
| `src/hooks/pre-pr-proof.ts:92-99` | same, inside `if (import.meta.main)` | directly |
| `src/scripts/cwd-changed.ts` | wraps an inline body, no `main()` | needs a body extraction first |
| `src/scripts/stop-summary.ts` | wraps an inline body, no `main()` | needs a body extraction first |

**Why it matters:** two spellings of "fail open" in one cluster. A change to the convention (e.g. adding a debug log on a swallowed error, which is the obvious next ask when a hook silently does nothing) lands in 7 files and silently misses 6.

**Codex dissent, recorded not dropped:** Codex judged the hooks cluster as *already* sharing a real runtime — "Ten import `hook-runtime.ts`. Six use `readHookInput`, five use `blockDecision`, five use `emitAdditionalContext`, five use `runHook`." That is correct and narrows this finding: the hooks do **not** independently reimplement stdin parsing or exit conventions. The gap is specifically the `runHook` wrapper, not the runtime. Report scoped accordingly.

**Fix:** convert the four direct cases; extract a `main()` in the two inline ones. ~24 lines deleted.

### N2 (medium, CONFIRMED — Claude+Codex convergent) — the security auditor hand-rolls the hook traversal that was extracted to stop exactly that

`src/lib/audit-hooks.ts:356-391` walks `hooks[event] → group[] → hook[]` with its own defensive `typeof`/`Array.isArray` guards. `src/lib/hook-command.ts:75-121` (`iterCommandHooks`) already does this walk — its own header says it "replaces three hand-rolled walks." `audit-hooks.ts` imports `parseHookCommand` from that file but not the iterator. It then calls `HooksBlock.safeParse` a *second* time at `:467-486` to produce the schema pseudo-finding.

**Why it matters:** this is the file whose entire job is supply-chain trust classification (`SECURITY.md`). If the auditor's walk and the canonical walk ever diverge in what shapes they tolerate, a malformed or malicious hooks block gets classified by one set of rules and fingerprinted by another — silently, in the control designed to catch tampering.

**Fix:** extend `iterCommandHooks` to yield `groupIndex`/`hookIndex` (the only fields `auditHooks` needs and doesn't get), consume it, delete the manual walk and the duplicate `safeParse`.

### N3 (medium, CONFIRMED — Codex-originated, self-verified) — hand-maintained interfaces sitting beside their zod schemas

Verified directly:
- `src/lib/review-queue.ts:23` — `export interface ReviewQueueState` maintained by hand next to `ReviewQueueStateSchema`.
- `src/lib/quota.ts:7` — `export interface RateLimitsCache` (and `QuotaSteerState`) beside their schemas.
- `src/lib/mcp.ts:43` — `McpServer`/`McpServers` re-inferred and re-exported despite canonical exports in `src/schemas/mcp.ts:106`.
- `src/hooks/statusline.ts:56` — `DriftResult` shadowed by a second local reader schema.

**Why it matters:** the schema and the interface must be edited together, and nothing enforces it. A field added to the schema but not the interface type-checks fine at every consumer and silently drops at runtime. This is the failure mode zod exists to prevent, reintroduced by hand one layer up.

**Fix:** `export type X = z.infer<typeof XSchema>` and delete the interfaces. Near-pure deletion.

*Scoping note:* this does **not** contradict the codemap/schemas reviewer's finding that zod is genuinely the runtime source of truth — it verified every `.parse`/`.safeParse` lands at a real boundary, which holds. The two findings are compatible: schemas do the parsing; the *types* are duplicated.

### N4 (medium, CONFIRMED — Codex-originated, self-verified) — one sentinel file, three models of it

`~/.claude/.cc-settings-version` is modeled three ways:
- `src/lib/status.ts:38` — a `z.looseObject` schema (`VersionSentinel`).
- `src/lib/version-delta.ts:74` — manual per-field reads with null fallbacks, in the file whose own header (`:13`) claims to be the source of truth for this file.
- `src/setup.ts:383` — an anonymous writer shape.

**Why it matters:** two readers model different subsets of one file while one of them claims exclusivity. A field added by the writer reaches whichever reader someone remembered.

**Fix:** one loose full schema, one reader, one writer. Delete `VersionSentinel`, the duplicate parse in `status.ts`, and the handwritten checks in `version-delta.ts`.

### N5 (medium, CONFIRMED — Claude+Codex convergent) — five lint CLIs re-type the same plumbing

`src/scripts/lint-{skills,agents,profiles,knowledge,research}.ts` each do: resolve arg → default dir → call `lint*Dir` → print `format*Findings` → exit on `has*Errors`. ~122 lines total.

The domain logic is **already** shared via `src/lib/lint-frontmatter.ts` (`lintFrontmatterCore`, `formatLintFindings`, `hasLintErrors`) — this is CLI plumbing only, which is why it rates medium and not high.

Codex adds a deeper cut worth recording: `src/lib/lint-agents.ts:49` and `src/lib/lint-profiles.ts:39` are near-clones at the *library* level too (flat markdown walk, angle-bracket check, zod issue expansion, name/file comparison). `lint-research` is genuinely different (parses H2/checklist structure, not frontmatter) and should stay separate.

**Fix:** one `runLintCli()` collapses each script to a line. Optionally `lintNamedMarkdownDir({schema, noun})` deletes one of the agent/profile library implementations.

## Structural Blockers

**None.** No file exceeds 1000 lines (largest: `src/setup.ts` at 664, down from 861 two audits ago). No spaghetti special-casing found in shared flows. `src/hooks/safety-net.ts` (561) was examined by two independent reviewers and both judged it cohesive policy code where splitting would rearrange rather than delete.

## Dependency Audit (context7)

Four direct dependencies. Essentially clean.

- **`zod@4.4.3`** — current (`latest` = 4.4.3). Idiomatic v4 throughout: 24 imports all from `"zod"` (correct for v4; `zod/v4` was the v3-transition path), and `src/schemas/emit.ts` uses native `z.toJSONSchema` rather than an extra dep. Clean.
- **`@types/bun@1.3.14`** — matches the Bun runtime exactly. Clean.
- **`@biomejs/biome@2.5.4` → `2.5.6`** (low). Fresh two-patch drift, published since the 2026-07-29 audit recorded 2.5.4 as current. Routine bump; `bun run lint` is clean at the pinned version.
- **`typescript@6.0.3`** — `latest` is `7.0.2`. **Not re-reported.** The 2026-07-29 audit recorded this as blocked upstream: TS 7 is the Go port (`microsoft/typescript-go`), whose own status table lists `API | not ready`, while `src/codemap/` consumes 34 distinct `ts.*` symbols. context7 confirms the position still holds — the native-preview README states "The native port of TypeScript is still in progress. We expect many gaps." **One prior rationale is now additionally supported:** the last audit noted a `tsgo`-for-speed split would create a two-deps-one-role duplication. This audit adds an independent reason it would buy nothing — `src/lib/tsc.ts:74` spawns `bunx tsc` with `cwd: options.cwd`, i.e. the *user's project*, so the hook path resolves the user's TypeScript, not this repo's pin. The pin governs only this repo's own `bun run typecheck`, measured at 1.7s. **Action: none. Remains blocked-upstream.**

No duplicated-role dependencies. No deletable dependencies. No deprecated APIs in use.

## Abstraction / Type Cleanup

### N6 (low, CONFIRMED — Claude+Codex convergent) — `settings-merge.ts` documents its most correctness-sensitive invariant by pointing at symbols the last audit deleted

`src/lib/settings-merge.ts:7-9` states MCP-preservation lives in `mcp.ts` as `resolveMcpServers`, plus a wrapper `mergeSettingsWithMcpPreservation`. `:521` repeats it; `:619` references the wrapper again. Grep across `src/` and `tests/`: **zero implementations of either symbol.**

They were removed by this audit series' own remediation — `docs/audits/nuclear-review-2026-07-29.md:106` records `resolveMcpServers`, `findUserOnlyServers` and `divergingFields` deleted in v12.16.0, "214 lines of `mcp.ts` deleted." The comments were not updated with the deletion.

The actual mechanism is a plain destructure at `src/setup.ts:212`: `const { mcpServers: _composedMcp, ...settingsForMerge } = fullComposed;`

**Why it matters:** the file's own header sends a reader (or an agent) to a non-existent symbol in another file for exactly the question that matters most here — how `mcpServers` avoids double-handling in the merge.

**Fix:** replace all three comments with what is true; delete the wrapper references.

### N7 (low, CONFIRMED) — `tool-cadence.ts` silently discards a documented user setting

`src/hooks/tool-cadence.ts:53`:
```ts
const THRESHOLD = Number(process.env.CC_PARALLELMAX_THRESHOLD) || 12;
```

`src/lib/hook-config.ts:16-26` exports `intEnv` whose doc comment warns against precisely this: "`|| fallback` would misread a legitimate 0 … as unset, silently reviving the default." The same file already reaches `intEnv` transitively — `tool-cadence.ts` imports `maxUnreviewed()` from `review-queue.ts`, which uses it for `CC_MAX_UNREVIEWED`.

**Why it matters:** `CLAUDE.md` documents `CC_PARALLELMAX_THRESHOLD` as user-configurable. A user setting it to `0` to force always-nudge gets 12 instead, with no error and no log. This is the only actual defect in the audit.

**Fix:** `const THRESHOLD = intEnv("CC_PARALLELMAX_THRESHOLD", 12);`

### N8 (low, CONFIRMED) — dead re-export whose justifying comment is false

`src/lib/team-knowledge.ts:23` re-exports `NON_NOTE_FILES` "so external consumers (lint-knowledge, tests) can import from team-knowledge.ts as before without knowing the source moved." Verified: `src/lib/lint-knowledge.ts:12` imports it **directly** from `./knowledge-index.ts`. Nothing imports it via `team-knowledge.ts`. The only symbol anyone imports from that module is `teamKnowledgeAwareness`.

**Fix:** delete the re-export at `:23` and the now-unused named import at `:19`.

### N9 (low, CONFIRMED) — `readState` + `safeParse` + default-on-failure duplicated ~8×

`src/lib/quota.ts:118-122, 128-132`; `src/hooks/statusline.ts:266-270, 281-283, 296-298`; `src/lib/hooks-fingerprint.ts:71-86, 241-255`. Same four-line shape, same intent (a malformed state file degrades to a safe default), no shared helper.

**Fix:** `readValidatedState<T>(name, schema, fallback, tmpDir?)` in `hook-runtime.ts`; collapse all sites to one-liners. Pairs naturally with N3 (same files, same boundary).

## Notes

Smaller items, verified but below the bar for their own finding:

1. `src/scripts/project-init.ts:71-97` — `createCursor` and `createWindsurf` are byte-identical apart from the filename; `createCopilot` is the same shape plus one line. One `createPointerFile(dir, relPath, extraLine?)`.
2. `getProjectName()` duplicated verbatim: `src/scripts/checkpoint.ts:32-35` and `src/scripts/handoff.ts:46-49` (whose comment admits the mirror). Both already import `artifact-store.ts`; this one fell through. Move to `src/lib/git.ts`.
3. `src/scripts/codex-run.ts:70-91, 111-119, 130-138` — three copies of result handling, already drifted in error wording.
4. `session-ledger.ts`'s `trimLedger` (the 4000→2000 trim) is the one export not directly exercised, and it is a read-modify-write on a file with two independent writer processes (`ledger-record.ts` via PostToolBatch, `post-failure.ts` via PostToolUseFailure). Low probability (needs 4000+ lines in one session) and self-limiting — the module already documents that a failed trim leaves the file readable. Worth a targeted test rather than a lock.
5. `src/hooks/quota-steer.ts:19` awaits `readHookInput` and discards the result. Likely a deliberate stdin drain; if so it wants a one-line comment saying that, since it currently reads as dead.
6. `upstream/claude-code-manifest.json:231` still lists `MultiEdit` in `knownBuiltinTools` while `src/lib/settings-merge.ts:91-94` prunes `MultiEdit(...)` rules as dead syntax. Data-file drift; `scan.ts` explicitly doesn't diff that list. Fix via `/cc sync`.
7. Codex proposes a three-way settings merge (previous managed baseline + current + live user) to retire the accumulated deprecated-pattern registries in `settings-merge.ts`, mirroring what `mcp_written` already solved for MCP. Genuinely ambitious and genuinely risky — it changes install semantics for every existing machine and needs a compatibility release. **Recorded for consideration, not recommended in this pass.**

## Documented / By-Design (verify still current)

**None.** All 24 team-knowledge notes were checked against these findings. Two are in scope and both are already-known limitations that no finding re-litigates: `cc-settings-installer-skips-nested-config-defaults` (array defaults don't reach existing installs — PR #127 / audit M9) and `cc-settings-hook-rename-stale-audit-flag` (closed in PR #51). No finding contradicts a documented decision, so nothing is reclassified or escalated.

## Remediation verification

Codex reviewed the full 24-file diff and returned **no findings** — but without itemized commentary against the two priorities it was asked to trace (the auditor traversal swap and the sentinel parse-leniency change). A blanket pass on a security control is not closure, so both were verified differentially against the pre-refactor code extracted from `HEAD`.

**N2 — auditor traversal (`auditHooks` old vs new), 24 targeted cases + 4000 generated inputs.**

The security-critical invariant is directional: the refactor must never find *fewer* hooks than before, because a hook that escapes audit is the failure mode that matters. Result: **0 hooks escaped across 4000 inputs.**

One genuine divergence exists and Codex did not surface it:

| input | old | new |
|---|---|---|
| bare hooks block, no `hooks` wrapper key — e.g. `{SessionStart:[{hooks:[…]}]}` | `[]` | 1 finding |

`iterCommandHooks` treats a bare block as the hooks candidate; the old `auditHooks` required `settings.hooks` to exist. Reachable only for a settings.json with **no** `hooks` key whose top level happens to parse as a hooks block — no key in the Settings schema holds an array of `{hooks:[…]}` objects, so this cannot occur in a well-formed file. The direction is safe (more is scanned, not less). **Recorded as an accepted behavior change, not a regression.**

All other cases identical, including: command trimming, whitespace-only and empty commands skipped, non-`command` hook types skipped, non-string commands skipped, group/hook index fidelity across multiple groups, malformed groups, null hook entries, non-array `groups`, and unknown forward-compat fields on both hooks and groups.

**N4 — sentinel readers, 26 cases across both readers.**

`readSentinelInfo` (version-delta.ts): **byte-identical** on all 16 cases — full modern sentinel, older installs missing newer fields, each field individually bad-typed, all fields bad-typed, unknown future field, empty object, JSON array/string/null/number, malformed JSON, empty file.

`gatherStatus`'s sentinel surface (status.ts): **byte-identical** on all 10 cases, **0 fields lost**. Note the implementer's stated rationale — that the per-field `.catch(undefined)` makes this strictly more lenient than a previous all-or-nothing parse — did not show up as an observable difference in any constructed case. The change is safe either way; the characterization was just more dramatic than the measurement supports.

*(Method caveat worth recording: the first version of the status differential compared field names that do not exist on `StatusData` — sentinel data is nested under `.sentinel` — so every case passed trivially. The corrected harness asserts the field is present and throws otherwise. A differential that compares nothing passes everything.)*

## Corrections — findings disproved by implementing them

Both were filed by this audit and withdrawn during remediation the same day. Recorded so a future audit does not re-file them.

- **N5 (five lint CLIs) — WITHDRAWN, implementation reverted.** The collapse was built and verified (all five CLIs exit 0, 34 tests pass) and was a **thin wrapper**: each script went 8 lines to 8 lines, the caller now supplies four callbacks that reconstitute the same four steps, and the repo grew +28 lines for one indirection hop. The finding assumed the five entry blocks were identical; they are not. Genuinely shared logic is ~6 lines (`process.argv[2]`, `console.log(format(result))`, bool→exit code). The variance is where the content lives: `lint-skills`' `checkManaged` gating, `lint-knowledge`' `KNOWLEDGE_REPO_PATH` fallback and early-exit, `lint-research`' file-vs-dir branch — all of which survive as callbacks, i.e. the complexity moved rather than disappeared. Codex's version of this proposed *one dispatcher* (a single script with a mode arg), which is a different and possibly viable change, but it conflicts with the hard requirement that five `package.json` entry points remain five entry points. **Under that constraint the collapse cannot pay off. Do not re-file.**
- **N3 site 4 (`DriftResult` shadowed in `statusline.ts`) — WITHDRAWN, not implemented.** `VersionDriftSchema` (`src/hooks/statusline.ts:56`) is not a duplicate of `DriftResult` (`src/lib/version-delta.ts:313`). It is a deliberately narrow reader of the `version-drift.json` state file, declaring only the two fields the statusline renders (`stale`, `installed` — used at `:284-285`) and omitting `packaged` because nothing displays it. Every field is optional by design: the file is written by another process, and the schema's own comment states a partial write, future schema change, or tampering must degrade to "absent" rather than feed garbage into a visible UI. This is a narrow projection at a JSON boundary — the same pattern this audit's own ledger already accepted for `permissions-doc.ts`. **Not debt. Do not re-file.**

N3 sites 1–3 (`review-queue.ts`, `quota.ts`, `mcp.ts`) were correct and landed.

## Open question from remediation

- **`installer` is a write-only sentinel field.** `writeVersionSentinel` in `src/setup.ts` emits `installer` (constant string `"src/setup.ts"`); no reader on either side has ever consumed it. Surfaced by the N4 work and deliberately left alone rather than resolved unilaterally — it is a harmless breadcrumb, not a bug. Decide whether to keep, wire up, or drop it.

## Considered / Rejected

- **`session-ledger.ts` has zero test coverage** — **DISPROVED**, and it was this audit's loudest candidate finding. A reviewer searched for `tests/*ledger*` , found nothing, and concluded the v13.0.0 module shipped untested including its redaction path. In fact `tests/session-continuity.test.ts` (858 lines) imports the module directly and exercises 7 of 9 exports: `entryForToolCall`, `pathFromToolInput`, `toProjectRelative`, `failureEntry`, `isSafeSessionId`, `appendEntries`, `readDigest`. `tests/context-continuity-gaps.test.ts` covers the on-disk format. Only `trimLedger` is untested — recorded as Note 4 at its real severity.
- **TypeScript 6→7 upgrade** — already ledgered blocked-upstream (2026-07-29 F5); position re-verified via context7 and additionally supported by the `bunx tsc` cwd finding. Not re-reported.
- **Merging `verify-hooks.ts` and `audit-hooks.ts`** — deliberate security split; merging would let the auditor refresh the fingerprint it validates against, i.e. let malware whitelist itself.
- **zod schemas not being the runtime source of truth** — disproved for *parsing*. Every `.parse`/`.safeParse` call in `src/` lands at a real boundary (setup, compose-settings, mcp, skill-prereqs, lint-*, hook-command, audit-hooks). N3 concerns duplicated *types*, which is a different claim.
- **`any` / cast-laundering** — zero `any` across every audited module; every `as X` narrows immediately at a JSON or `Error` boundary. The prior audit's rejection still holds.
- **Files over 1000 lines** — none. Largest source file is 664.
- **`setup.ts` should be split further** — rejected by both a Claude reviewer and Codex independently: it is legitimate orchestration, and the last split already took it 861→651.
- **`safety-net.ts` (561) as spaghetti** — rejected by two independent reviewers; cohesive policy/parser code with shared helpers.
- **37 scripts reimplementing arg parsing** — largely disproved; only the lint-CLI shape (N5) and non-overlapping switch dispatchers exist.
- **`install-lock.ts` stale-reclaim as over-engineered** — rejected; every piece is justified by a documented correctness guarantee and unit-tested.
- **`checkpoint.ts` / `handoff.ts` as mergeable** — rejected; they share the real mechanism (`artifact-store.ts`) and diverge sharply in domain logic.
- **`claude-audit.ts` (459) / `session-start.ts` (426) as disorganized** — rejected; both are clean phased pipelines with rationale comments.
- **`codemap/` re-implementing lib's file walking** — investigated; overlap is shallow and the consumers differ materially (codemap's walk is a fallback for missing tsconfig, needs `.tsx`/`.mts`/`.cts` and `.d.ts` exclusion). Not a code-judo win.
- **`status.ts` / `artifact-store.ts` / `session-ledger.ts` / `review-queue.ts` overlap** — disproved; distinct data, distinct storage, no shared schema.
- **`codex.ts` broad catch** — verified load-bearing; every catch classifies into a documented `CodexState`. Fail-open is the contract.
- **Prior findings F1/F2/F3/F6** — independently re-verified as remediated (`4f0d984`, `9c83642`, `fccce62`).
- **Unifying `DEPRECATED_COMMAND_PATTERNS` / `DEPRECATED_PERMISSION_PATTERNS` / `TOMBSTONE_SKILLS`** — rejected; three structurally different match shapes at three merge sites. Unifying adds a layer without deleting logic. (Codex's three-way-merge proposal in Note 7 is the version of this idea that *would* delete logic.)

## Phase 4 — Documentation

Not performed: this pass produced findings only, no code changes. Whoever applies the fixes owns the doc pass per the skill's Phase 4 table. Expected scope when N1–N9 land: a consolidated `CHANGELOG.md` `[Unreleased]` entry; no `MANUAL.md` change (no skill/agent/hook added or removed); `bun run schemas:emit` only if N3's `z.infer` conversion touches a schema in `src/schemas/` (it should not — N3 targets `src/lib/` types).
