# Three-way settings merge — design

**Status: T-1/T-2 (baseline write) shipped in v13.1.0 — see `feat(v13.1.0): record a
settings baseline on each install; decline the three-way merge`. T-3–T-6 (the
three-way engine itself) were designed, costed, and explicitly declined — see the
header of `src/lib/settings-baseline.ts` and note 7 below. This document is now a
historical record of that decision, not an open task — the "Plan complete" line at
the end does not apply. All point-in-time numbers below (repo HEAD, test count, line
counts) are pinned to when this was written and must be re-measured before any future
work resumes.**

Status: design only, no code changed. Repo HEAD e2560ae (v13.0.6). Baseline `bun test`
= 1068 pass, 0 fail — this design's implementation must leave that number intact (plus
new tests) at every step.

Scope: replace the heuristic deprecated-pattern machinery in
`src/lib/settings-merge.ts` (~172 of 656 lines, ~26%) with a real three-way merge, using
the same recorded-provenance pattern the repo already ships for MCP (`mcp_written` in
the version sentinel — `src/lib/version-delta.ts`, `src/lib/mcp.ts`).

**Headline finding, stated up front so it isn't buried at the end**: the ~172-line
deletion does **not** happen in this change. Every existing install has no baseline
snapshot. The new code must special-case that (§3), and the only safe special case is
"behave exactly like today's heuristics" — which means `DEPRECATED_PERMISSION_PATTERNS`,
`DEPRECATED_COMMAND_PATTERNS`, and everything that reads them stay in the file,
indefinitely, as the fallback path. This design adds a three-way engine *alongside* the
heuristic one; it does not let you delete the heuristic one. See §3 and §7 for why, and
§6 step T-6 for the one thing that *does* land now (marking the registries as
fallback-only in a comment, so the next person doesn't wonder why "dead" code is still
there).

---

## Functional DAG

```
prereq ── none (design phase produces no branch/install step; implementer starts from HEAD e2560ae)

src/lib/version-delta.ts ──────┐
                                ├── T-1 baseline schema + read/write ──┐
src/lib/json-io.ts ─────────────┘  (new src/lib/settings-baseline.ts)  │
                                                                        ├── T-3 three-way engine ──┐
src/lib/settings-merge.ts ─────────────────────────────────────────────┘  (settings-merge.ts,      │
                                                                            optional baseline param) │
                                                                        ┌── T-2 wire baseline WRITE ─┤
src/setup.ts ───────────────────────────────────────────────────────────┘  (installSettings)         │
                                                                                                       ├── T-4 wire baseline READ ──┐
                                                                                                       │  (installSettings passes    │
                                                                                                       │   it into mergeSettings)    │
                                                                        ┌── T-6 mark registries        │                            │
                                                                        │  fallback-only (comment)      │                           │
                                                                        └────────────────────────────────┘                          │
                                                                                                                                      ├── T-5 differential fuzz suite ──┐
tests/settings-merge.test.ts (frozen contract, run UNEDITED) ────────────────────────────────────────────────────────────────────────┘                                 │
                                                                                                                                                                        ├── bun test (1068+N pass, 0 fail)
tests/settings-merge-differential.test.ts (new) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Read: `T-1` (baseline schema/IO) is the one prerequisite both `T-2` (wire the write side
into `setup.ts`) and `T-3` (the three-way engine itself) need — those two are the first
parallel batch, since `T-2` only touches `setup.ts`'s existing read-back-after-write step
and `T-3` only touches `settings-merge.ts`, disjoint files. `T-4` (wire the read side)
needs both, because it calls the new engine (`T-3`) with a value produced by the new IO
module the write side (`T-2`) proved works. `T-6` (mark the registries as fallback-only)
only needs `T-3` to exist so the comment can reference it, and touches none of `T-4`'s
lines — second parallel batch. Nothing is shippable until the terminal `bun test` gate,
which needs both the untouched 861-line contract suite and the new differential suite
green.

```
Batch 0 (prereq):     none
Batch 1 (parallel):   T-1 baseline schema + IO
Batch 2 (parallel):   T-2 wire baseline write · T-3 three-way engine
Batch 3 (parallel):   T-4 wire baseline read · T-6 mark registries fallback-only
Batch 4:              T-5 differential fuzz suite
Batch 5 (terminal):   bun test — 0 fail, tests/settings-merge.test.ts unedited
```

---

## 0. Terminology (load-bearing — the rest of the doc assumes these definitions)

A three-way merge needs three inputs per key/item, not two. Today's `mergeSettings` only
ever sees two (`team`, `user`); the whole heuristic apparatus exists because there is no
third. Naming them precisely:

- **`base`** — what `mergeSettings` itself wrote to `~/.claude/settings.json` at the end
  of the *previous* install. Not "the team fragment from last time" — the actual
  merged output, because that is what the user's file diverged FROM. This distinction
  matters: `base` includes the user's own prior extras too (a hook group they added by
  hand, still there from last time), not just cc-settings' contribution. Recorded once,
  read-only afterward, until the next install overwrites it.
- **`team`** — `composeSettings(source)`'s output THIS run (unchanged concept, same as
  today's `teamSettings` parameter).
- **`user`** — the current on-disk `~/.claude/settings.json`, read at the start of THIS
  run (unchanged concept, same as today's `userRaw`).

Every decision table below is a function of `(base, team, user)` for one key or one
array item. The nine cases, referenced by number throughout:

| # | base | team | user | Verdict |
|---|---|---|---|---|
| 1 | absent | absent | present | User's own — keep `user` |
| 2 | absent | present | absent | Team added since base — adopt `team` (interactive: prompt for the array strategies; scalar/deep-merge keys already land team-only silently today, see §2.5) |
| 3 | absent | present | present, equal | Converged — keep either |
| 4 | absent | present | present, differs | Both introduced independently, no shared ancestor — today's ordinary scalar-conflict path (user wins by default, can prompt) |
| 5 | present | equal to base | equal to base | Untouched everywhere — no-op |
| 6 | present | equal to base | **differs from base** | **User edited this after we wrote it — KEEP THE EDIT, unconditionally.** This is the case a bug here would be catastrophic for. |
| 7 | present | **differs from base** | equal to base | Team changed and the user never touched it — adopt `team`'s new value. If `team` no longer has this item at all, **delete it**. This one rule is the entire replacement for `DEPRECATED_PERMISSION_PATTERNS`, `DEPRECATED_COMMAND_PATTERNS`, `pruneDeprecatedHooks`, and `hooksSuperseded` — derived from a recorded fact instead of a maintained regex list. |
| 8 | present | differs from base | differs from base, **equal to team** | Both moved to the same new value — no conflict, keep it |
| 9 | present | differs from base | differs from base, **differs from team too** | Real conflict: team changed AND the user independently changed to something else. Default: keep `user` (matches every existing non-interactive default), but count it separately in accounting from case 6 (a "collision," not a plain edit) — interactive mode prompts exactly as `resolveScalarConflict` does today |

Case 7 is the one to hold onto reading the rest of this doc: it is not a new invention,
it is "the deprecated-pattern registries, generalized." Today, `DEPRECATED_PERMISSION_PATTERNS`
hard-codes "if the string is exactly `Write(*)`, and we know we used to ship it, delete
it." Case 7 says the same thing without needing to know the string in advance: "if
`base` had it, `team` no longer does, and `user`'s copy is still identical to what `base`
recorded (i.e. the user never customized it), delete it." The regex list encoded facts
about history that a recorded baseline makes redundant.

---

## 1. Where the baseline lives

**Decision: its own file, `~/.claude/.cc-settings-baseline.json`. Not the sentinel.**

Why not the sentinel (`~/.claude/.cc-settings-version`, read by `readSentinel` /
`readSentinelInfo`):

- **Size.** `mcp_written` is a handful of MCP server definitions (small, bounded — one
  entry per code-intel engine server, currently just `tldr`). The settings baseline is
  the merged output of the *entire* `settings.json`, and that is not small:
  `config/40-hooks.json` alone is 317 lines of JSON; permissions, env, statusLine, and
  the rest add more. Folding a multi-KB object into the sentinel changes it from "a
  dozen scalar fields plus a small MCP map" into "most of settings.json, again."
- **Hot path isolation.** `readSentinelInfo` runs on every `SessionStart`
  (`src/scripts/session-start.ts` calls `resolveEngine(CLAUDE_DIR)`, which reads the
  sentinel to resolve the code-intel engine — this is not optional, incidental code, it
  runs unconditionally every session). The baseline is read exactly once per run, by the
  installer, during `mergeSettings` — never by a hook. Putting a multi-KB object behind
  a file every session-start hook parses is pure downside for zero benefit to that path.
- **Separation of concerns matches an existing precedent in the same codebase.** The
  hooks-tamper fingerprint (`src/lib/hooks-fingerprint.ts`,
  `~/.claude/.cc-settings-hooks-fingerprint`) already lives in its own file rather than
  the sentinel, for exactly this reason — it's written by the installer, read by a
  different hook, and has no business bloating the file every session-start read
  touches. The baseline follows the same shape: one small file per concern.

Content: not a bare copy of `settings.json` — wrap it with a version stamp, mirroring
the sentinel's own `version` field, so a corrupt-vs-stale distinction is possible later
if ever needed (not required for correctness now, but costs nothing to record):

```ts
// src/lib/settings-baseline.ts (new file)
export const SettingsBaselineSchema = z.looseObject({
  version: z.string().optional().catch(undefined),   // cc-settings VERSION at write time
  written_at: z.string().optional().catch(undefined),
  settings: z.record(z.string(), z.unknown()).optional().catch(undefined),
});
```

`z.looseObject` + per-field `.catch(undefined)`, same pattern as `SentinelSchema` in
`version-delta.ts` — a single malformed field degrades to absent for that field only,
never invalidates the whole read. `readBaseline` returns `null` on a missing file,
unparseable JSON, or a non-object top level — identical failure contract to
`readSentinel`.

Written by: `installSettings` in `src/setup.ts`, at the exact point it already reads the
just-written `settings.json` back for the hooks fingerprint (line ~238,
`mergedReadBack`). No new disk read needed — reuse that value:

```ts
// inside installSettings, right after fingerprintSettingsHooks(mergedReadBack):
if (mergedReadBack !== null) {
  await writeSettingsBaseline(CLAUDE_DIR, VERSION, mergedReadBack);
}
```

Read by: `installSettings`, before calling `mergeSettings`, threaded through as a new
optional parameter — mirrors exactly how `priorMcpWritten` is threaded from
`readSentinelInfo` through to `installMcpToClaudeJson` today. No new pattern invented;
same shape, different file.

---

## 2. The three-way rules, per merge strategy

Each strategy below states its decision table as the nine-case model from §0, plus
strategy-specific exceptions carried over from current behavior. `item` = whatever unit
of identity the strategy already uses today (a rule string for permissions arrays, an
event+group for hooks, a key for env/deep-merge/statusLine).

### 2.1 `permissionsStrategy` — `allow` / `ask` / `additionalDirectories`

Item identity: the rule string itself (unchanged — `unionPermissionArray`'s `id = (r:
string) => r`). `additionalDirectories` is paths, never subject to case 7's deletion
(unchanged: `pruneDeprecated = false` today for exactly this reason — a path is not a
tool-permission rule and must never be silently dropped because it resembles a retired
pattern).

| Case | Rule in base | Rule in team | Rule in user | Verdict |
|---|---|---|---|---|
| 1 | no | no | yes | keep (user's own rule) |
| 2 | no | yes | no | team addition — **interactive prompt** ("Team added N new rule(s), adopt?"), same as today |
| 5/6 (item-level, no "edit" concept for a bare string) | yes | n/a | n/a | a string rule can't be "edited," only present/absent — collapses to presence checks below |
| 7 | yes | no | yes, unchanged | **DELETE** — this is `DEPRECATED_PERMISSION_PATTERNS` made general: base recorded a rule cc-settings shipped, team dropped it, user's copy is still exactly what base recorded (never customized) → gone |
| — | yes | no | **no** (user already removed it themselves) | no-op either way — nothing to delete, nothing to add |
| — | yes | yes | yes | unchanged, all three agree — keep |

Because rule identity is a bare string, there is no "user edited the rule" case
distinct from "user has a different string" — a changed rule is a different item
(delete old + add new), which case-7-delete plus case-2-add already covers. This is
strictly better than today's registries: any future retired rule is handled without a
new regex entry, *provided a baseline exists* (see §3 for when it doesn't).

### 2.2 `permissionsStrategy` — `deny`

Same item model as 2.1, **with one override that is NOT derived from the three-way
model**: `deny` rules present in `team` are unconditionally included in the merged
output regardless of `base`/`user` state. This is `unionPermissionArray`'s existing
`alwaysAccept = true` guardrail — a user cannot silently drop a security-relevant deny
rule by editing settings.json, and the three-way engine must preserve that floor
explicitly, not derive it. Case 7's deletion rule still applies for a `deny` rule
`team` has genuinely *retired* (not one still shipped) — a retired deny rule that the
user's copy still matches base gets removed same as any other case-7 item.

### 2.3 `permissionsStrategy` — `defaultMode` / `autoMode` scalars

Direct application of the nine-case scalar table (§0). Today's code only implements
cases 4/9 (via `resolveScalarConflict`, fired whenever `t[k] !== u[k]` — no base, so it
can't distinguish 4 from 9, or detect 6/7 at all). With a baseline:
- Case 6 (user edited, team unchanged) → **keep user's edit without prompting**, even in
  interactive mode — today's code would incorrectly treat this as a conflict and
  interactively re-ask the user to confirm something they already decided. This is a
  net UX improvement the baseline enables, not just parity.
- Case 7 (team changed, user never touched) → adopt team's new value silently.
- Case 9 (real collision) → prompt exactly as today.

### 2.4 `hooksStrategy` — two-level model (the hard one)

Hooks are two levels deep: per event, an array of **groups**; each group has a `hooks[]`
array of individual command entries. Today's code keys groups by whole-group
`canonicalKey` (matcher + `if` + entire `hooks[]` contents, order-insensitive) for the
top-level add/remove decision, then ALSO reaches inside any surviving user-only group
via `pruneDeprecatedHooks` to strip individual deprecated hook entries — because a group
can be *mixed* (one hook the user added, one hook cc-settings shipped, bundled by the
user into the same matcher). Whole-group identity alone cannot both (a) delete a
whole stale group cleanly and (b) preserve a user's own hook that happens to share a
group with a stale one. The three-way replacement needs the same two levels:

**Level A — group "slot" identity.** Key groups within an event by `(matcher, if)`
(not the full `hooks[]` payload). Apply the nine-case model treating the group's
`hooks[]` array as the "value" being compared:
- Case 1/2/3/4: slot exists only in one/two of {team, user} with no base record — same
  add/keep logic as today (team-only → interactive prompt; user-only → keep).
- Case 6: slot's `hooks[]` differs from what `base` recorded, `team`'s `hooks[]` for that
  slot is unchanged from `base` → the user edited their copy of a team-owned slot
  (e.g. changed a timeout) → keep the user's version.
- Case 7: `base` had this slot, `team` no longer has a matching `(matcher, if)` at all →
  **the whole slot is gone from team**. Recurse to Level B on the user's `hooks[]` for
  that slot (do NOT blanket-delete — some of those hooks may be the user's own,
  unrelated to why the slot changed shape).

**Level B — inside a slot whose team-side shape changed or disappeared,** three-way
merge the `hooks[]` array itself, keyed by `command` string (fallback: `canonicalKey`
of the whole hook object, for a command-less/malformed entry — never throw):
- A hook `command` present in `base` and unchanged in `user`, but absent from `team`'s
  current set of commands for this event → **delete just that hook entry**. This
  reproduces `pruneDeprecatedHooks`'s per-hook pruning inside a mixed group exactly,
  and reproduces `hooksSuperseded` too: a hook cc-settings evolved (added a `timeout`,
  changed a flag) is, at the command-string level, often the *same* command string
  with different sibling fields — in that case it's really a scalar-field diff on the
  hook object, handled the same way case 6/7/9 handle any object leaf. A hook whose
  command string itself changed (e.g. `parallelmax-nudge.ts` → `tool-cadence.ts`) is a
  delete-of-old-command + add-of-new-command pair, same as a retired permission rule.
- A hook `command` the user added themselves (not in `base`, not in `team`) → always
  kept, regardless of what happens to the rest of the group. This is the guarantee the
  current `pruneDeprecatedHooks` + supersede-check machinery exists to protect ("user
  group wiring their own (non-managed) script is never superseded" — the existing test
  of that name).
- If Level B empties a group entirely (every hook in it deleted), drop the group. If a
  slot from `team` is new relative to `base`, insert it as a whole new group (Level A
  case 2).

**Behavior change worth flagging explicitly, not silently:** under this model, a user
who deliberately deletes a hook `command` that `team` still ships (present in `base` and
`team`, absent from `user`) has that deletion **respected** — case analogous to "item in
base+team, absent from user." Today's code does not support this: `hooksStrategy`
always re-includes every team group regardless of whether the user removed it
(`teamKept` only shrinks via the interactive-decline path for *newly added* team-only
groups, never for a group the user actively deleted after having it). No existing test
exercises "user had a team hook from a prior install and deleted it" with a baseline
present, so this is not a contract violation of the frozen suite — but it IS a policy
change the implementer should call out in the PR description, not bury. Recommendation:
adopt it (respecting a deliberate user deletion is more correct), but this is a judgment
call the user of this design doc should make consciously, not something T-3 should ship
silently.

### 2.5 `envStrategy`

Flat key-value map, item identity = key. Direct nine-case scalar table application:
- Case 6 (user edited an env value team hasn't touched) → keep user's edit, no prompt
  even interactively (today's code prompts on ANY `t[k] !== u[k]`, conflating case 6
  with case 9 — same UX improvement as §2.3).
- Case 7 (team changed the value, user never touched) → adopt team's new value silently.
- Case 9 (real collision) → prompt as today (`resolveScalarConflict`), counted as
  `envUserWins`/`envAdoptedScalars` same as now.
- A key `team` has fully *removed* relative to `base`, with `user`'s copy unchanged →
  case 7 with team-absent → delete the env var. Today's code has no equivalent (env
  vars are never pruned) — this is new coverage, not a behavior regression, and matches
  the intent of the deprecated-pattern machinery (cc-settings has never needed to
  retire an env var yet, but if it does, this closes that gap for free).

### 2.6 `statusLineStrategy`

Object treated as a single unit (unchanged granularity — today's code doesn't merge
inside `statusLine`, it picks the whole object). Nine-case table applied to the whole
object as "the value":
- Case 6: user's statusLine object differs from `base`, `team`'s is unchanged from
  `base` → keep user's (today's default "user wins" — unchanged outcome, now derived
  rather than assumed).
- Case 7: `team`'s statusLine changed (e.g. cc-settings' own script path moved) and
  user's is still exactly what `base` recorded → adopt `team`'s new value. This
  subsumes the `commandIsDeprecated` reset-to-team check with no regex needed — the
  "reset" is just case 7 firing on the whole statusLine object.
- The existing `commandIsDeprecated(u.command)` special case (reset to team even
  without base data) becomes the §3 fallback's job only — see below.

### 2.7 Deep-merge default (`userWinsScalarStrategy` / `deepMergeUserWins`)

Every leaf in the recursive deep-merge gets the same nine-case scalar table, applied
per leaf path (`key.subkey.subsubkey`, matching the existing path-naming used in
`resolveScalarConflict` prompts). Object-valued and array-valued leaves keep their
existing "user wins whole, no merge" rule for the array case (unchanged — three-way
diffing an array of unstructured scalars, e.g. `spinnerVerbs.verbs`, has no reliable
item identity the way permission rules or hook commands do, so this is deliberately
NOT extended to arbitrary arrays outside permissions/hooks). For object-valued leaves,
the existing "team-only sub-key lands into an existing user block" behavior
(`defaultsAdded` accounting, the `attribution.sessionUrl` regression guard) is exactly
case 2 recursing one level deeper — no change needed there, it already behaves as a
degenerate two-case (`base` absent for every key, since there is no per-leaf tracking
today) version of the same table. With a baseline, it gains cases 6/7/9 the same way
env and permissions do: a user-edited nested scalar that team hasn't touched is kept
without prompting (case 6), and a nested key team has fully retired gets removed if the
user never touched it (case 7) — new coverage, not present today at all (nothing in
`deepMergeUserWins` currently deletes a stale nested key).

---

## 3. The no-baseline fallback (the hard part, and the finding)

**Every existing install has no baseline file today.** Selecting the fallback is a
single, cheap check at the top of `mergeSettings`: `if (baseline === null) { run exactly
today's code }`. Concretely:

```ts
export async function mergeSettings(
  existingPath: string,
  teamSettings: Record<string, unknown>,
  outputPath: string,
  opts: MergeOptions = {},
  baseline?: Record<string, unknown> | null,   // NEW, optional — default undefined
): Promise<MergeAccounting | null> {
  // ...unchanged userRaw read + no-existing-file short-circuit...

  if (!baseline) {
    // Byte-identical to current mergeSettings — the DEPRECATED_* registries and
    // every function that reads them (permissionRuleIsDeprecated,
    // commandIsDeprecated, isDeprecatedHook, pruneDeprecatedHooks, the
    // prune/supersede loop in hooksStrategy) run EXACTLY as they do today.
    return mergeSettingsLegacy(userRaw, teamSettings, outputPath, opts);
  }
  // ...three-way path (§2) uses baseline...
}
```

**Confirmed: the existing registries must be retained, not deleted, and this is true
indefinitely, not just "until baselines are ubiquitous."** Reasoning:

1. The baseline file is written by THIS design's new code. It cannot exist before this
   code has run at least once. The very first run of the new installer, on every
   existing machine, therefore has no baseline and must produce output identical to
   today's — which is only possible if today's logic is still there to run.
2. After that first run, the baseline exists going forward *on that machine* — but
   cc-settings has no telemetry and no way to force every install to upgrade
   sequentially. A user who restores `~/.claude` from an old backup, skips several
   versions and does a fresh `--rollback` then re-install, or hand-deletes the baseline
   file, lands back in the no-baseline case on a machine that is otherwise fully
   current. The fallback is not a bridge to a future without it — it is a permanent
   safety net for "we don't have provenance for this install," the same category of
   defense-in-depth the mcp_written sentinel already treats as normal (`priorMcpWritten`
   being `null` is an explicitly handled, permanent case in `mcp.ts`, not a transitional
   one).
3. Given (1) and (2), there is no version N after which it is safe to *automatically*
   delete `DEPRECATED_PERMISSION_PATTERNS` / `DEPRECATED_COMMAND_PATTERNS` /
   `pruneDeprecatedHooks` / `isDeprecatedHook` / `commandIsDeprecated` /
   `permissionRuleIsDeprecated`. Deleting them is only safe once a human decides the
   population of baseline-less installs is small enough that reverting to raw
   union-forever behavior for them is an acceptable regression — a policy call, not a
   code-derived one. That's out of scope for this change entirely; note it and move on
   (§6 T-6 is the one artifact this design produces about it: a comment marking the
   registries as "fallback-only, load-bearing for baseline-less installs, see
   docs/settings-merge-three-way-design.md §3" so nobody mistakes them for dead code
   later).

So: **the ~172-line deletion promised in the task's "why" section does not happen as
part of implementing this design.** What this design buys instead: every install that
already has a baseline (i.e., every install one version deep into this change) stops
depending on the registries at all for anything that happens after adoption, and any
*future* deprecation (a script rename, a hook removal) needs zero new registry entries
for baseline-holding installs — only baseline-less stragglers still need one, and that
population shrinks over time. The 172 lines become dead weight for a shrinking
population rather than active load-bearing logic for everyone; actually deleting them is
a separate, later decision this design deliberately does not make.

---

## 4. Differential test plan (non-negotiable)

Goal: for a no-baseline install, the new implementation must be **byte-identical** to
current output for every input, and `tests/settings-merge.test.ts` must pass **unedited**.

### 4.1 The frozen suite as one differential channel

`tests/settings-merge.test.ts`'s 861 lines never construct a `baseline` argument — every
call site is `permissionsStrategy(key, team, user, ctx)` /
`hooksStrategy(...)` / `mergeSettings(userPath, team, outPath)`, all without a fifth
parameter. Since the new signature's `baseline` parameter is optional and defaults to
the no-baseline branch, this suite passing unedited **is itself** the first and
strongest differential proof — it directly exercises "no baseline → old behavior" across
every case the current suite's authors thought to write (MultiEdit pruning, Write/Glob/
NotebookEdit exact-match pruning, mixed-group hook pruning, supersession, duplicate
collapse, statusLine reset, safeParse forward-compat). **No edits to this file are
required or permitted** — if T-3's refactor makes any of these tests fail, that is a
regression in the refactor, not a signal to update the test.

### 4.2 Golden-reference fuzz differential (the broader proof)

The frozen suite only covers cases its authors anticipated. To prove byte-identical
output across inputs it does *not* cover, freeze the CURRENT `settings-merge.ts` (HEAD
e2560ae) as a test-only golden reference and run both implementations over generated
inputs:

1. Copy `src/lib/settings-merge.ts` as it exists at HEAD e2560ae to
   `tests/fixtures/settings-merge-legacy.ts` (a frozen, test-only artifact — not
   shipped, not imported by any production code, deleted once the differential suite
   has run green in CI at least once and its result is trusted; note this cleanup in
   the PR that lands T-5, don't leave it as permanent clutter).
2. Write a generator producing realistic `(team, user)` pairs — no baseline needed for
   this channel, since the whole point is "no-baseline behavior must match": randomize
   over
   - permission rule arrays mixing ordinary rules, exact deprecated-pattern strings
     (`Write(*)`, `MultiEdit(...)`, etc. — literally reuse
     `DEPRECATED_PERMISSION_PATTERNS`'s own fixtures as generator seeds), and
     near-miss strings (`Write(~/secrets/*)`, case variants) that must NOT be pruned,
   - hook groups mixing managed (`bun "$HOME/.claude/src/{scripts,hooks}/*.ts"`) and
     unmanaged commands, single- and multi-hook groups, groups with/without `if`/
     `matcher`, deliberately reusing every command string from
     `DEPRECATED_COMMAND_PATTERNS` as generator seeds plus random unmanaged ones,
   - env maps with overlapping/disjoint keys and scalar/array/object value shapes,
   - statusLine objects with deprecated and non-deprecated `command` values,
   - nested objects/arrays/scalars for the deep-merge default strategy.
   Bun's built-in `Math.random`-seeded generator with a fixed seed (reproducible CI
   failures) is sufficient — no new dependency needed; do not reach for a property-
   testing library only for this.
3. For every generated `(team, user)` pair, run BOTH
   `mergeSettingsLegacy` (frozen fixture) and the new `mergeSettings(..., baseline:
   null)` and assert the canonicalized (`canonicalKey`, already in `merge-keyed.ts`)
   JSON output is identical, AND that every field of `MergeAccounting` matches.
4. Target: hundreds of generated pairs is enough to be meaningful (this is a
   deterministic-logic diff, not a statistical property test — a few hundred
   combinations covering the cross-product of "item present in 0/1/2 of
   {team,user}" × "deprecated/not" × "single/mixed group" exhausts the interesting
   state space; thousands buys little extra confidence for meaningfully more CI time).

New file: `tests/settings-merge-differential.test.ts`. This is an ADDITION, not an edit
to the frozen suite — satisfies "the 861-line suite must pass unedited" literally.

### 4.3 New three-way behavior tests (separate from differential)

A third, smaller test file, `tests/settings-merge-baseline.test.ts`, covering the
NEW behavior only possible with a baseline present — one test per case 6/7/8/9 per
strategy from §2's tables (permission rule survives an edit, permission rule gets
deleted after team retirement, hook command gets deleted from a mixed group without
disturbing the user's own hook in that group, env var silently adopts a team change
the user never touched, statusLine resets via case 7 with no regex needed, deep-merge
nested key gets deleted per case 7). These are new tests for new code paths — no
constraint that they match old behavior, because old behavior never had this input
shape (a baseline) to react to.

---

## 5. Migration and first-run behavior

**First run after this ships (no baseline file exists):**
1. `installSettings` calls `readBaseline(CLAUDE_DIR)` → `null` (file absent).
2. `mergeSettings(..., baseline: null)` → fallback branch, byte-identical to today.
3. After the merge writes `settings.json`, `installSettings` reads it back (existing
   `mergedReadBack` step, reused) and calls `writeSettingsBaseline(CLAUDE_DIR, VERSION,
   mergedReadBack)`.
4. Every subsequent run on that machine has a baseline and takes the three-way path.

**Baseline file is corrupt / partial / unparseable JSON:** `readBaseline` catches the
parse error and returns `null` — identical treatment to "absent." Never partially
trusted. This is the same contract `readSentinel` already has for the sentinel file
(`try { JSON.parse(...) } catch { return {}; }`), so there's no new failure-handling
idiom to invent.

**Baseline parses as a JSON object but fails `SettingsBaselineSchema`'s shape** (e.g.
`settings` field is an array, not an object): the same per-field `.catch(undefined)`
pattern `SentinelSchema` uses means only the malformed field degrades — if `settings`
itself is unusable, treat the whole baseline as absent (there is nothing to three-way
merge against without it); if only `version`/`written_at` are malformed, `settings` can
still be used (those two fields aren't consulted by the merge logic at all in this
design — recorded for future debugging only).

**Baseline is from a much older cc-settings version than the current `team` /
current `user`:** no special handling needed, and this is not a degradation. An old
baseline is still a completely valid ancestor for the diff — three-way merge doesn't
care HOW old the common ancestor is, only whether it's the actual ancestor, and it is:
it really is what this installer wrote at whatever install produced it. The nine-case
table works the same whether `base` is one version old or ten. (Contrast with the
version-drift *nudge* feature in `version-delta.ts`, which is a display concern —
unrelated to whether the baseline is usable for merging.)

**Every failure mode above degrades to the SAME fallback path (§3), never to deletion.**
There is no failure mode in this design where a corrupt/partial/stale baseline causes
MORE deletion than the current heuristic registries would — worst case is exactly
today's behavior, because "baseline unusable" and "baseline absent" are the same code
path by construction.

---

### 5.1 Rollback interaction — a PREREQUISITE for T-4, found while shipping T-1/T-2

`createBackup` (`src/lib/install-fs.ts`) archives `.claude/settings.json`,
`MANAGED_TOP_LEVEL_PATHS`, and `.claude.json`. It does **not** archive the baseline — and
it does not archive the version sentinel or the hooks fingerprint either. That is a
deliberate, consistent convention: provenance/state files are excluded alongside
`backups/`, `tmp/`, `logs/`, and `tldr-cache`. The baseline correctly follows it.

The consequence matters only once something READS the baseline. After `--rollback`,
`settings.json` is restored to an older state while the baseline still describes the
NEWER install. A three-way merge would then compare the restored file against a base it
never produced, and case 7 ("team dropped it and the user's copy still equals base") could
fire against a value the restored settings legitimately carries — i.e. delete user data.

Not a problem today: nothing reads the baseline, so a stale one is inert.

**Before T-4 wires the read, one of these must happen** (this is a decision, not a
default — the same question applies to the sentinel's `mcp_written`, which has this
latent staleness today):
1. `cmdRollback` deletes `~/.claude/.cc-settings-baseline.json` when it restores — the
   baseline's own contract already treats absent as "no provenance, use the fallback",
   so deletion degrades safely and needs no new code path. **Recommended.**
2. Or the baseline joins the backup set, so it is restored in lockstep with the
   `settings.json` it describes. Consistent, but reverses the convention above and
   invites the same question for the sentinel and fingerprint.

Option 1 is strictly safer: it fails toward "no provenance", which is the case the
fallback is built for anyway.

---

## 6. Ordered implementation steps

Smallest, independently verifiable, first. Each step's verification is a concrete
command/assertion, not "works correctly."

**T-1 — Baseline schema + read/write (new file `src/lib/settings-baseline.ts`)**
- Add `SettingsBaselineSchema` (mirrors `SentinelSchema`'s loose/`.catch` pattern),
  `readSettingsBaseline(claudeDir): Promise<Record<string,unknown> | null>`,
  `writeSettingsBaseline(claudeDir, version, settings): Promise<void>`.
- Pure IO, no merge-logic changes anywhere yet.
- Verify: new unit test — round-trip write→read returns the same object; missing file
  → `null`; corrupt JSON → `null`; non-object top-level `settings` field → `null`, other
  fields still readable. `bun test tests/settings-baseline.test.ts` — new file, 0 fail.
- Effort: ~30 min.

**T-2 — Wire baseline WRITE into `installSettings` (`src/setup.ts`)**
- After the existing `fingerprintSettingsHooks(mergedReadBack)` call (~line 239), add
  `if (mergedReadBack !== null) await writeSettingsBaseline(CLAUDE_DIR, VERSION,
  mergedReadBack);`.
- No merge-logic change — `mergeSettings` itself is untouched by this step.
- Verify: run `bun src/setup.ts` (or the equivalent E2E harness already used for
  install testing) against a tmp `HOME`; assert `~/.claude/.cc-settings-baseline.json`
  exists afterward and its `settings` field deep-equals the just-written
  `settings.json`. Full `bun test` still 1068 pass, 0 fail (no production merge logic
  touched).
- Effort: ~20 min. Depends only on T-1.

**T-3 — Three-way engine in `settings-merge.ts`**
- Add the optional `baseline` parameter to `mergeSettings` (signature in §3).
- Extract current logic into `mergeSettingsLegacy` (or keep it inline under an
  `if (!baseline)` guard — implementer's call, but the no-baseline branch must be
  provably the same code, not a re-derivation of it — literally reuse the existing
  function bodies of `permissionsStrategy`/`hooksStrategy`/`envStrategy`/
  `statusLineStrategy`/`userWinsScalarStrategy` unchanged for this branch).
- Add the three-way variants per §2's tables, gated behind `baseline !== null`. Each
  strategy needs a baseline-aware sibling or an added parameter — implementer's
  choice of shape, but keep the no-baseline path byte-for-byte the existing functions.
- **Do not touch `tests/settings-merge.test.ts`.**
- Verify: `bun test tests/settings-merge.test.ts` — 861 lines, 0 edits, 0 fail (proves
  the no-baseline path is unchanged). Full `bun test` still 0 fail.
- Effort: 3–5 hours — this is the substantial step; §2.4 (hooks, two-level) is the
  bulk of the complexity.

**T-4 — Wire baseline READ into `installSettings`**
- Before calling `mergeSettings`, add `const baseline = await
  readSettingsBaseline(CLAUDE_DIR);` and pass it through:
  `mergeSettings(userSettingsPath, settingsForMerge, userSettingsPath, { interactive },
  baseline?.settings ?? null)`.
- Verify: integration test simulating two sequential installs — install v1 (writes
  baseline), mutate `team` to drop a permission rule that v1's `user` still carries
  unedited, run install v2, assert the rule is gone (case 7 firing) and that a
  DIFFERENT rule the user hand-edited between v1 and v2 survives (case 6). Add this as
  `tests/settings-merge-baseline.test.ts` (§4.3). Full `bun test` still 0 fail plus the
  new file's cases.
- Effort: ~1 hour. Depends on T-2 and T-3.

**T-5 — Differential fuzz suite**
- New file `tests/settings-merge-differential.test.ts` per §4.2. Freeze
  `tests/fixtures/settings-merge-legacy.ts` from HEAD e2560ae.
- Verify: `bun test tests/settings-merge-differential.test.ts` green; wire into
  whatever CI entry point runs `bun test` today (no new CI job needed if `bun test`
  already runs everything under `tests/`).
- Effort: 2–3 hours (generator + assertions).

**T-6 — Mark the registries as fallback-only (comment only, no logic change)**
- In `settings-merge.ts`, above `DEPRECATED_PERMISSION_PATTERNS` and
  `DEPRECATED_COMMAND_PATTERNS`, add a note: these patterns are now consulted ONLY by
  the no-baseline fallback path (`mergeSettingsLegacy`); every baseline-holding install
  uses the general three-way rule in §0 case 7 instead. Cross-reference this doc's path
  (`docs/settings-merge-three-way-design.md`) so a future reader doesn't mistake "still
  present" for "still load-bearing for everyone."
- Verify: `bun run lint` clean (comment-only change, nothing to test).
- Effort: ~10 min. Depends on T-3 (needs the fallback path to exist to describe).

**Terminal — full `bun test`**: 1068 (existing) + new files from T-1/T-4/T-5, 0 fail.
`bun run typecheck` clean.

---

## 7. Risk list

| Risk | What could silently eat a user's settings | Guard |
|---|---|---|
| Baseline write fails/partial (disk full, crash mid-write) | Next run's `readBaseline` sees corrupt JSON | `atomicWriteJson` (tmp+rename, already used everywhere else in this codebase) — a partial write never produces a parseable-but-wrong file; worst case is the OLD baseline survives (stale-but-valid) or the write never lands and next run degrades to `null` (§5) |
| Baseline schema drifts from the merge engine's assumptions across a future refactor | A future `settings` shape change makes old baselines "valid JSON, wrong meaning" | `SettingsBaselineSchema` is loose + per-field `.catch`, but the `settings` blob itself is `z.record(z.string(), z.unknown())` — no deep validation. Case 6 is the only case where trusting a stale `settings` shape could actively cause harm (a false "user edited" positive is always SAFE — it just keeps the user's value, same as today's default). No case in §0's table produces incorrect *deletion* from a malformed baseline value at a single key — a per-key mismatch just falls through to "differs from a garbage base" which reads as case 4/9, both of which default to keep-user. This is a designed-in safety property, not an accident — call it out to the implementer explicitly so a future refactor of the case table doesn't lose it |
| Level A/B hook slot-keying (§2.4) misidentifies which group a hook "belongs to" across an edit that changes BOTH `matcher` and `if` simultaneously | A hook the user customized inside a group whose `(matcher, if)` also changed gets treated as "team removed this slot" (case 7) and deleted rather than merged | This is a genuine edge case with no clean fix at the two-level granularity described — flag it in the differential fuzz generator (§4.2) as a case to include explicitly (a group where BOTH matcher and if change between base/team while the user has customized a hook inside it), and if the fuzz suite finds this produces deletion of user content, fall back to whole-group `canonicalKey` identity for that slot (today's exact behavior) rather than the refined `(matcher,if)` keying — i.e. Level A degrades to today's granularity on ambiguity, never invents new deletion behavior. State this as a required assertion in T-5, not an afterthought |
| Someone deletes the frozen legacy fixture (`tests/fixtures/settings-merge-legacy.ts`) after "the differential suite ran green once," and a later refactor of `mergeSettings` silently changes no-baseline behavior with nothing left to diff against | Silent regression in the one path every existing install still depends on | Keep the frozen fixture until this design's author (or whoever ships T-3–T-5) explicitly signs off removing it in a PR description that says why — don't let "differential suite passed once in CI history" substitute for "the fixture is still there for the NEXT refactor too." This is a process risk, not a code one — call it out in the PR body per rules/git.md's test-plan conventions |
| `deny`'s `alwaysAccept` override (§2.2) gets accidentally subsumed into the general nine-case table during implementation, since it looks like it "should" just be case 2/7 like everything else | A future team-shipped `deny` rule removal could get silently un-added if an implementer "simplifies" `deny` to match `allow`/`ask` | Keep `alwaysAccept` as an explicit, separately-tested override — the existing test `"deny always accepts team additions — guardrail"` behavior (`alwaysAccept = true` param in `unionPermissionArray`) must be preserved as a NAMED special case in the three-way code, not folded away for symmetry with `allow`/`ask`. T-3's differential suite (§4.2) must include a case where `team` retires a `deny` rule still present in `user`+`base` unedited, confirming case 7's deletion still fires for `deny` too (the override only affects ADDITION policy, not the case-7 deletion path) |
| Respecting a user's deliberate hook-command deletion (§2.4's flagged behavior change) surprises a user who now finds cc-settings does NOT restore a hook they meant to keep but accidentally deleted | Loss of a hook the user wanted, framed as "the merge respected your edit" | Not a merge bug — a genuine product-behavior decision flagged in §2.4. Recommendation: ship it (it's more correct), but state it plainly in the PR body's "What this does," not just the diff — per rules/git.md, "signal, not spam" but this is exactly the kind of behavior change a reviewer needs named up front |

---

## Summary for the implementer

- Files touched: new `src/lib/settings-baseline.ts`; `src/setup.ts` (two small wiring
  additions); `src/lib/settings-merge.ts` (the substantial change — new baseline-aware
  branch, existing branch left byte-identical); new test files only, zero edits to
  `tests/settings-merge.test.ts`.
- The 172-line deletion this task was framed around does not happen — see §3. What
  ships instead: a parallel three-way path that activates once a baseline exists, with
  the heuristic path retained as a permanent (not transitional) fallback.
- Hand T-1/T-2 to `scaffolder` (boilerplate schema+IO file, pattern already exists in
  `version-delta.ts` to copy from) once this design is approved. Hand T-3–T-5 to
  `implementer` as a single briefing — they're too interdependent (same file,
  same test contract) to split across parallel agents. T-6 can ride along with T-3's
  PR as a one-line addition, not a separate handoff.

~~Plan complete. Delegate to implementer for execution.~~ (Superseded — see the status
banner at the top of this document. T-3–T-6 were declined, not delegated.)
