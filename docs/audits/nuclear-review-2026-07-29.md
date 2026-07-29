# Nuclear Review — Whole-Codebase Maintainability Audit

- **Repo:** cc-settings @ `6c11274` (main), v12.15.0
- **Date:** 2026-07-29
- **Method:** Phase 0 inline map → prior-audit remediation verification → structural pass on the 40 commits since the last audit → context7 dependency audit → Codex cross-model pass (completed cleanly, 7 findings) → team-knowledge reconciliation (23 notes, corpus reachable) → synthesis.
- **Baseline:** `docs/audits/nuclear-review-2026-07-20.md` (17 findings). **16 of 17 verified fixed**; the 17th (N3, TypeScript 6→7) is reframed below rather than re-reported. Its Considered/Rejected ledger was honored — nothing in it is re-litigated except one entry whose *stated basis* has gone stale (recorded below).
- **Result:** 7 findings — 0 high / 5 medium / 1 low / 1 plausible-pending-verification. 5 CONFIRMED, 1 CORRECTED (F4 — see its entry; the filed measurement was wrong), 1 PLAUSIBLE. No source file exceeds 1000 lines. No By-Design escalations.
- **Remediation status:** F1, F2 landed in v12.15.1 (`4f0d984`). F3, F4 landed in v12.15.2 (`9c83642`). F6 measured, promoted to CONFIRMED, and landed in v12.16.0. F5 is a ledger entry (no code). F7 alone still needs the verification it names.

## Verdict

**NEEDS RESTRUCTURING (targeted)** — the mildest form, for entirely different reasons than 9 days ago.

The remediation record is the headline: 16 of 17 prior findings landed in 9 days, including all four code-judo moves (`buildInstallPlan` deleted, `pruneArtifacts` extracted, the linter reporting layer collapsed, `install-fs.ts` split out — `setup.ts` went 861 → 651 lines). The codemap gap that worried the last audit most (N8: public surface defined twice, tested zero times) is genuinely closed — `src/codemap/tools.ts` is now a single registry and `tests/codemap-mcp.test.ts` exercises the JSON-RPC framing end to end.

What blocks CLEAN is concentrated almost entirely in the newest module. `src/lib/pinned-tools.ts` shipped 1 day ago (v12.14.0) and is the repo's second verified-download implementation, carrying a duplicated security boundary (F1) and a generic interface with a hardcoded assumption inside it (F2). Beyond that: one function parameter that some reads honor and others silently ignore, with the test suite conceding it in a comment (F3), and a reference doc that documents 35 of 108 schema keys while calling itself complete (F4). Roughly one day of consolidation, no rework.

## Code-Judo Opportunities

### F1 (medium, CONFIRMED — Claude+Codex convergent) — two verified-download implementations; extract the primitive, delete ~45 duplicated lines
`src/lib/engine-pin.ts:136-190` (`ensurePinnedEngine`) and `src/lib/pinned-tools.ts:153-253` (`ensurePinnedTool`) independently implement the same state machine: platform-key checksum lookup → warn+null when unpinned → dest path under `~/.claude/code-intel/<id>/<version>/<bin>` → reuse-if-hash-matches → `mkdir` → `${dest}.${pid}-${Date.now()}` temp → `fetch` → `!res.ok` warn+null → catch warn+null → `writeFile` → `hashFileOrNull` → **mismatch: `rm` then throw** → `rename` → `chmod 0o755`. The error strings are the same sentence with one noun changed ("engine not installed" / "tool not installed").

The duplication includes the security boundary itself. A future hardening of the mismatch path (e.g. the SLSA/sigstore provenance gate that `engine-pin.ts:97-104` already stubs) lands in one and silently misses the other.

**Scenario:** `verifyProvenance` graduates from stub to real verifier. `ensurePinnedEngine` gains it; `ensurePinnedTool` — which downloads a ~55MB third-party Rust binary from a GitHub release — does not, and nothing fails or warns to say so.

**Fix:** extract `downloadAndVerify({url, dest, expectedSha256, label}): Promise<string | null>` returning the verified temp path (fail-soft null, hard throw on mismatch, guaranteed cleanup). The two callers then differ only in what they do *after* verification — `rename` + pin record, versus `tar -xf` + lift the binary out + sidecar. That is the genuine difference the second module was created for; everything upstream of it is copy.

### F2 (medium, CONFIRMED) — `PinnedToolDescriptor` is generic in shape and single-purpose in fact; the second tool fails soft and lies about why
`src/lib/pinned-tools.ts:235` hardcodes the archive's inner directory:

```ts
const extractedBinary = join(staging, `tldr-cli-${plat.triple}`, tool.binName);
```

`PinnedToolDescriptor` (`:37-46`) advertises five configurable fields — `id`, `version`, `binName`, `urlTemplate`, `platforms` — and no field for the archive's internal layout. Exactly one descriptor exists (`TLDR_CODE_TOOL`), and exactly one call site passes it (`setup.ts:310`).

**Scenario:** someone adds a second pinned CLI whose tarball extracts to `bin/<name>` rather than `tldr-cli-<triple>/<name>`. Download succeeds, checksum verifies, `tar` exits 0, then `:236` finds nothing and returns `null` via `progressWarn("expected binary missing from archive — tool not installed")`. That message points at upstream's packaging; the actual cause is a missing descriptor field. Fail-soft turns a code bug into a plausible-looking upstream problem.

**Fix:** add `archiveBinPath: string` to the descriptor with the same `<TRIPLE>` token substitution `urlTemplate` already uses (`"tldr-cli-<TRIPLE>/tldr"`), making the generality real for one added line — or, if a second tool isn't actually coming, delete the interface and name the function `ensureTldrCode()` so the surface stops promising what it can't do.

**Related, and the reason to prefer the descriptor fix:** the two modules' trust anchors differ in a way the header doesn't admit. `engine-pin.ts:151` compares an existing binary against `expected` — the checksum **in source**. `pinned-tools.ts:178-181` compares it against a `.sha256` **sidecar file written next to the binary at install time**, because the descriptor pins the archive rather than its contents. So engine installs self-heal from binary tampering (hash ≠ source constant → re-download) while tool installs cannot (attacker-writable sidecar is the only record). This is **not** reported as a security finding — `SECURITY.md:342-343` explicitly places "a targeted attacker with full user-privilege write access" outside the threat model, and the tool is opt-in behind `CC_PINNED_TOOLS`. It is reported because the module header claims to "mirror engine-pin.ts's security discipline" and the disciplines materially differ, and because pinning the *extracted binary's* sha256 in the descriptor alongside the archive's would achieve real parity **and delete the entire sidecar mechanism** (`digestSidecarPath`, its write, its read — ~12 lines) rather than documenting the gap.

## Structural Blockers

### F3 (medium, CONFIRMED — Codex-only, verified) — `gatherStatus` takes a `claudeDir` it only partly honors, and the tests say so in a comment
`src/lib/status.ts:78` accepts `claudeDir` ("Path to the ~/.claude directory (install target)" per its own JSDoc at `:74`), but `:176-177` reads the module-level constant `CLAUDE_JSON_PATH` — `join(homedir(), ".claude.json")` from `mcp.ts:46` — ignoring the parameter entirely. `readState()`/`autoUpdateStatus()` resolve against the real host dir the same way.

`tests/status.test.ts:110-113` concedes it rather than covering it:

> `autoUpdateStatus()/readState()` inside `gatherStatus` always resolve against the REAL host CLAUDE_DIR (not the tmp `claude` dir passed in here) … So this can only assert shape, not tmp-fixture-scoped values.

**Scenario:** a test (or a `--dry-run` against a staging dir) passes a tmp `claudeDir` expecting isolation. Settings/permission counts come from the fixture; MCP server list and auto-update state come from the developer's real `~/.claude.json`. The assertion passes or fails based on the host machine, so the suite either can't assert the interesting values (today's compromise) or becomes machine-dependent.

**Fix:** thread one `InstallPaths` value (`claudeDir`, `claudeJsonPath`, sentinel path) instead of mixing a parameter with module-level constants. Status tests become hermetic and the global-path exceptions disappear. Codex's broader version of this — consolidating the sentinel's schema/read/write, currently split across `setup.ts:370`, `version-delta.ts:30`, and a second parser in `status.ts:35`/`status-types.ts:6`, into one `install-state` module — is the same fix at a larger radius and is worth taking together.

### F4 (low, CORRECTED — the original measurement was wrong) — the key table was 106 of 108, not 35 of 108; the real gap was that nothing enforced it

> **Correction (2026-07-29, during remediation).** As filed, this finding said the doc "documents 35 of 108 schema keys." That number counted `###` **prose headings** and missed the `## Complete settings.json key reference` table further down the same file — a 106-row inventory with type, class, and description columns. Measured properly: **108 schema root keys, 106 table rows, and zero phantom rows.** Only `advisorModel` and `respondToBashCommands` were missing. Both Claude and Codex reported the inflated version (Codex said 37 of 108), because both counted headings; convergence between two models is not the same as either one having measured the right thing. Severity drops medium → low.

The surviving finding is smaller and different in kind: a hand-maintained 106-row table with **no mechanism to catch divergence from the schema**. Two keys had already drifted, and nothing would have reported a third.

**Scenario:** a key is added to `src/schemas/settings.ts` (as `advisorModel` was in v2.1.98). Typecheck passes, tests pass, install works. The table silently no longer matches the schema it claims to mirror, and a reader looking the key up concludes cc-settings doesn't support it.

**Fix as landed:** the two missing rows added, plus `tests/docs-settings-keys.test.ts` asserting parity **in both directions** — every schema key has a row, every row has a schema key — with duplicate and sort checks. Verified to fail on an omitted row and on an invented one.

Full generation from the schema (the original fix, and Codex's recommendation) was **rejected on measurement**: it would replace hand-written Class and Description columns — "which tier does this belong to", "what breaks if you set it" — with zod type names, losing the judgment that makes the table worth reading. That is the same reasoning already in this report's rejected ledger for the prose sections; it applies to the table too. A check preserves the content and still makes "complete" true by construction.

## Dependency Audit (context7)

Four direct dependencies — among the leanest manifests this audit has seen; nothing to cut.

- **`typescript@6.0.3` — latest is `7.0.2`, and staying on 6 is now CORRECT. Reframing prior N3, not re-reporting it (F5, low, CONFIRMED).** `npm dist-tags` confirms `latest: 7.0.2`, so the version gap the last audit flagged is real. But its recorded unblock paths ("codemap adopts the TS 7 API surface, or the compiler API is pinned as a separate aliased dependency") assumed a TS 7 programmatic API exists. It does not: `microsoft/typescript-go`'s own status table lists **`| API | not ready | - |`**. `src/codemap/` consumes 34 distinct `ts.*` symbols (`createProgram`, `forEachChild`, `getParsedCommandLineOfConfigFile`, the `TypeChecker`), loaded at runtime via `program.ts:22`'s dynamic import. The blocker is upstream and neither listed unblock path is currently possible. **Action: none. Record as blocked-upstream so future audits stop re-costing it.** Re-check when typescript-go's API row moves off "not ready". The runtime path already degrades correctly if the API vanishes (`program.ts:24` gates on `typeof ts?.createProgram === "function"` → `null`); only `tsc --noEmit` would break, which is a compile-time signal, not a user-facing failure.
- **`zod@4.4.3`** — current. Idiomatic v4 throughout, no deprecated v3 patterns. Clean.
- **`@biomejs/biome@2.5.4`** — current; prior N17 patch drift landed. Clean.
- **`@types/bun@1.3.14`** — matches the Bun 1.3.14 runtime exactly. Clean.
- No duplicated-role dependencies. No deletable dependencies. Note that adopting `tsgo` for the `tsc --noEmit` speedup while keeping `typescript@6` for the codemap API would introduce exactly the two-deps-one-role duplication this skill flags — not worth it for a repo whose typecheck already runs in ~2s.

## Abstraction / Type Cleanup

Nothing material. Cast/`any` density in all five modules added since the last audit is effectively zero (`pinned-tools.ts`, `install-lock.ts`, `install-fs.ts`, `codemap/tools.ts`, `mcp.ts`: no `any`, no `as unknown as`; `unknown` appears only at JSON boundaries where `asRecord()`-style narrowing is the established pattern). The prior audit's type-boundary rejection still holds.

## Documented / By-Design (verify still current)

- **None.** All 23 team-knowledge notes were checked against these findings; no note covers pinned-binary installation, `status.ts` path handling, settings-reference generation, or the TypeScript major. No finding contradicts a documented decision, so nothing is reclassified or escalated.
- `history-belongs-in-git-not-code` was checked against `pinned-tools.ts`'s 21-line header. It survives: the header states current *constraints* (why the archive path differs, why `tldr-mcp` is never installed, what fails soft vs hard), not a narrative of past states. The prior audit's related Note about extraction-history headers (`"extracted from src/setup.ts"`) still applies to `install-cmds.ts`/`install-display.ts` and is still not urgent.

## Plausible — Pending Verification

### F6 (CONFIRMED — promoted from PLAUSIBLE, fixed in v12.16.0) — dual MCP persistence, one half of which was inert

> **Resolved 2026-07-29.** This finding was filed PLAUSIBLE precisely because its remedy depended on an external fact neither model had established: which file Claude Code treats as authoritative. That fact was then measured against the real binary in three controlled conditions using a throwaway `HOME`:
>
> | Condition | Result |
> |---|---|
> | Server in `settings.json` only, `~/.claude.json` also present | server **does not appear** in `claude mcp list` |
> | Server in `~/.claude.json` only | server **appears** |
> | Server in `settings.json`, `~/.claude.json` present but with no `mcpServers` key | **"No MCP servers configured"** — so `settings.json` is not even a fallback |
>
> Corroborated independently by the official docs' configuration-locations table, which lists MCP storage as `~/.claude.json` / `.mcp.json` and never `settings.json`; no doc sentence links `mcpServers` to `settings.json` (the only `*McpServers*` settings keys are the managed `allowedMcpServers`/`deniedMcpServers` **policy** lists).
>
> **Verdict: the `settings.json` copy was inert.** Not a redundant-but-working second source — dead configuration. That promotes the finding from PLAUSIBLE to CONFIRMED and makes the remedy a deletion rather than a trade-off.
>
> The decisive detail found while scoping: `setup.ts` fed the same resolved `teamMcp` into both writers specifically so they "never disagree about which engine backs the `tldr` server (H9)". An entire past defect class existed only to keep the inert copy in sync with the real one.
>
> Safety was verified before cutting, since the deletion removes an interactive prompt: `installMcpToClaudeJson` merges `{ ...teamMcp, ...effectiveCurrentMcp }`, so user-only servers in `~/.claude.json` survive **by construction**. The prompt, `CC_WIPE_CUSTOM_MCP`, `resolveMcpServers`, `findUserOnlyServers`, and `divergingFields` existed solely to guard the copy nothing read — 214 lines of `mcp.ts` deleted with no loss of protection.
>
> Landed in v12.16.0 with a one-time migration (`pruneSettingsMcpServers`) that removes the block prior installs left behind, scoped to entries cc-settings itself wrote. Verified end-to-end against a seeded fake `HOME`: 4 inert entries removed, a hand-added server and an unrelated `model` value preserved, all 4 servers still resolving from `~/.claude.json`.

**Original finding, for the record:**
Team MCP definitions are composed into `settings.json` *and* written into `~/.claude.json` (`setup.ts:181-192`), which forces two reconciliation paths (`mcp.ts:241`, `mcp.ts:403`), the `mcp_written` sentinel that exists to infer ownership afterward, a `resolvedMcpServers` special branch in the otherwise-generic merger (`settings-merge.ts:522`), and a 1,130-line test file covering the resulting state matrix. The duplication is factual and the cost is visible.

Not confirmed as debt, for two reasons. First, the code documents a deliberate reason: `settings.json` keeps the static `tldr` fragment while `~/.claude.json` receives the resolved engine's command — "the single point where the engine swaps in behind the `tldr` name" (`setup.ts:186-190`). Second, Codex's remedy ("verify Claude Code's current precedence, then delete one write path") rests on an external fact neither model established: which file wins when both define `mcpServers`. The memory note `code-intel-engine-contract` records `mcp_written` as "what lets installer changes reach existing machines," suggesting it is load-bearing.

**Next step before any restructuring:** establish Claude Code's actual precedence between `settings.json` and `~/.claude.json` `mcpServers`. If one is authoritative, the other write path and its half of the test matrix can go. If both are consulted for different purposes, this is by-design and belongs in the rejected ledger permanently.

### F7 (PLAUSIBLE, Codex-only) — light-profile skill prune may be partly redundant with the clean phase
`cleanOldConfig` removes every `MANAGED_SKILLS` directory (`install-fs.ts:287-289`); the light branch then copies only `LIGHT_SKILLS` back and *also* executes `lightProfilePruneTargets` (`install-fs.ts:336+`). If clean already removed all managed skill dirs and light only restored the light subset, the skill-directory portion of the prune has nothing to do — though the same prune list also covers full-only `rootFiles`/`dirs`, which clean does not, so the redundancy is partial at most.

Held at PLAUSIBLE deliberately: this code is 9 days old and is the *product* of the prior audit's N1 fix, which moved the prune computation here on purpose. Overturning fresh, deliberately-placed code needs a full read of `wipeTasks` against `MANAGED_SKILLS` and `PROFILE_MANIFEST`, plus a light-install-over-full-install test, not the two-hunk comparison behind this note.

## Considered / Rejected

- **Re-reporting any of the prior audit's N1–N17** — 16 verified fixed by direct inspection (`buildInstallPlan` gone, `ReviewQueueStateSchema` hoisted, `MANAGED_TOP_LEVEL_PATHS` added, `frontmatter-validate` delegating to the `lint*Dir` functions, `pruneArtifacts` in `artifact-store.ts`, `formatLintFindings` shared, `codemap/tools.ts` registry, `intEnv` exported, `NON_NOTE_FILES` imported, `emitAdditionalContext` added, `handoff.ts` parallelized, `inProjectSourceFiles` in `program.ts`, biome patched). Not re-litigated.
- **Codex's "delete the no-op `validatedHooks`/`auditInput` success branch" (`audit-hooks.ts:411`)** — **refuted.** `validatedHooks` is consumed at `:445-446`, where it substitutes the schema-parsed hooks block back into the reconstructed audit input (`{...parsed, hooks: validatedHooks}`). It is not dead and the branch is not a no-op. The adjacent claim that the shared iterator should yield group/hook indices does directly answer the prior audit's reason for rejecting that consolidation, so that half stays open — but it is a small win behind a real refactor, not the deletion Codex described.
- **`tests/mcp.test.ts` at 1,130 lines (the only handwritten file over 1k)** — not flagged as a blocker. It is a test file, and splitting it into schema/reconciliation/persistence suites before F6 resolves would reorganize a state explosion rather than reduce it. Codex independently reached the same disposition.
- **`src/codemap/` existence** — rejection upheld, but **the prior ledger's stated basis is now stale and is corrected here.** It read: "not reachable in a default install (default engine is `llm-tldr`; `native-ts` requires explicit `CC_CODE_INTEL_ENGINE`)." Since v12.9.0 `DEFAULT_ENGINE_ID = "native-ts"` (`code-intel-engine.ts:104`), and this machine's install sentinel records `"engine": "native-ts"`. Codemap is now the default code-intel path for every full install. That makes the conclusion stronger, not weaker — it is load-bearing infrastructure with a single tool registry and protocol-level tests as of the N8 fix — but any future audit reasoning from "it's opt-in, so the bar is low" would be reasoning from a fact that is no longer true.
- **`install-lock.ts` (new, 194 lines)** — inspected, not flagged. Exclusive-create token lock with PID liveness and staleness checks, one consumer (`setup.ts:485`), `isProcessAlive` unit-tested. Proportionate to the problem (concurrent installs corrupting a merge).
- **Collapsing the agent/profile linters (Codex #6)** — deprioritized rather than rejected. The prior audit already ruled the *general* six-linter collapse out and scoped the justified part to formatting (N7) and discovery (N5), both of which landed. Codex narrows the claim to `lint-agents.ts` + `lint-profiles.ts` specifically, which is plausible residual overlap, but with the mechanical core already shared via `lint-frontmatter.ts` the remaining win is small and the risk of flattening genuine per-kind rules is not.
- **Generating `settings-reference.md` wholesale** — the *inventory* should be generated (F4), but not the prose. The hand-written examples for the ~35 documented keys carry judgment (when to enable, what breaks) that a schema cannot emit.

## Notes

- **No fixes were applied in this session** — this is report-only, so the skill's Phase 4 doc pass is deferred. Whoever lands F1–F4 owes a `CHANGELOG.md` entry per commit; none of these findings move a zod surface, so `bun run schemas:emit` should be a no-op (verify with `bun run schemas:check`).
- **Verification state at audit time:** `bun run typecheck` clean, `biome check` clean (178 files), `bun run lint:skills` clean (39 skills), `bun test` 1021 pass / 0 fail.
- **Fix routing:** F1+F2 are one `pinned-tools`/`engine-pin` PR and should ship together (F1's extraction is where F2's descriptor field naturally lands). F3 is one `status`/`install-state` PR. F4 is one docs-generation PR. F5 is a ledger entry, no code. F6 needs an upstream-behavior answer before it becomes a PR at all.
- **Convergence summary:** Claude and Codex independently flagged the duplicated verified-download path (F1) — the single highest-conviction finding of this run. Codex-only findings F3 and F4 both survived manual verification with exact line traces and counts. Claude-only finding F2 came from reading the newest module against its own header claims. One Codex finding was refuted outright (`validatedHooks`), and two were held at PLAUSIBLE rather than promoted (F6, F7) because their remedies depend on facts neither model established.
- **Trajectory observation worth more than any single finding:** the debt in this run is 1–9 days old and sits almost entirely in the newest module, while the previous run's debt is gone. The repo's failure mode is not accumulation — it is that each new module re-implements a discipline an existing module already owns (`pinned-tools` vs `engine-pin` here, exactly as `checkpoint`/`handoff` vs `artifact-store` last time, and the linter reporting layer before that). The durable countermeasure is a pre-merge question rather than a periodic audit: *which existing module already does the mechanical part of this?*
