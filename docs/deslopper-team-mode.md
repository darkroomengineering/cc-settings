# Deslopper — Team Mode

Loaded on demand by `agents/deslopper.md` when the Mode Selection table says to fan out
(>= 100 files, >= 10K LOC, or an explicit "use teams" / "fan out" signal). Solo mode never
reads this file. Installed path: `~/.claude/docs/deslopper-team-mode.md`.

---

**Team Mode Workflow**

> **Naming note.** This is *subagent fan-out*, not Claude Code's "agent teams" feature. It needs
> nothing enabled. Spawn the scanners directly and collect their returned results.

In team mode the deslopper becomes a **coordinator** — it does NOT scan files itself. All scanning is delegated to read-only agents. Only the coordinator edits files.

1. **Create 3 tasks** via `TaskCreate` — one per scanner (dead-code, duplicates, integrity)
2. **Spawn 3 `explore` subagents in ONE message** (all `Agent` calls in a single response):
   - `Agent(explore, "dead-code-scanner prompt...", description="dead-code-scanner")`
   - `Agent(explore, "duplicates-scanner prompt...", description="duplicates-scanner")`
   - `Agent(explore, "integrity-scanner prompt...", description="integrity-scanner")`
3. **Wait for all 3** — each subagent's findings return in its result. Track progress with `TaskList`.
4. **Merge scanner outputs** into the standard report format (see Merge Protocol)
5. **Run self-check + recursive passes** (Phase 4 + 4b) on merged findings — the coordinator verifies each finding, then runs up to 3 cascade passes on modified files
6. **Auto-fix confirmed dead code** — coordinator has Edit tool, scanners do not
7. **Sync docs** (Phase 5) — fix stale references, counts, and index entries broken by removals
8. **Present merged report** using the standard Output Format with approval flow

No shutdown step: a subagent ends when it returns its result. If you need follow-up work from one, `SendMessage` its name to resume it from its transcript rather than spawning a replacement.

**Key constraint**: Scanners are `explore` type (read-only). They cannot edit files. This prevents conflicting writes and keeps the coordinator as the single source of truth for changes.

---

**Scanner Prompts**

Use these templates when spawning scanner subagents. Each scanner writes its findings as a message back to the coordinator.

### dead-code-scanner

```
You are a dead code scanner for the deslopper team.

**Scope**: Find all dead code — unused exports, orphaned functions, unreferenced constants, dead imports.

**Tools to use**:
- `tldr dead . --entry-points "main,test_"` — dead code scan. If it returns `unsupported-by-native-engine`, the scan DID NOT RUN: report that, fall back to Grep, never report "no dead code"
- `tldr impact <name> .` — verify specific exports have zero callers
- `Grep` — cross-check import statements

**Process**:
1. Run `tldr dead .` to get the full dead code report
2. For each finding, run `tldr impact` to confirm zero callers
3. Check for dynamic usage patterns (string interpolation, re-exports) that TLDR may miss
4. Classify confidence: HIGH (zero callers, no dynamic use) or MEDIUM (zero callers, possible dynamic use)

**Output format** — send this as a message to the coordinator:

DEAD CODE FINDINGS
| # | Symbol | File:Line | Confidence | Evidence |
|---|--------|-----------|------------|----------|
| 1 | functionName | path/file.ts:42 | HIGH | tldr impact: 0 callers, no dynamic refs |

TOTAL: N findings (X high, Y medium)

**Truncation rule**: Report top 50 findings in the message. If more than 50, write the full list to /tmp/deslop-dead-code-full.txt and note the path.
```

### duplicates-scanner

```
You are a duplicates scanner for the deslopper team.

**Scope**: Find duplicate and near-duplicate code — exact copies, semantic duplicates, copy-paste indicators.

**Tools to use**:
- `Grep` — find identical function signatures and repeated patterns
- `tldr semantic "<description>" .` — find semantically similar code
- `Glob` — locate files for pattern matching

**Process**:
1. Grep for repeated function signatures across the codebase
2. Use `tldr semantic` with common pattern descriptions:
   - "API fetch", "data fetching", "HTTP request"
   - "form validation", "input validation"
   - "error handling", "error boundary"
   - "date formatting", "string formatting"
3. Identify copy-paste indicators: similar variable names, identical comments, same magic numbers
4. For each duplicate pair, assess effort (Low/Medium/High) and benefit

**Output format** — send this as a message to the coordinator:

DUPLICATE FINDINGS
| # | Category | Location A | Location B | Similarity | Effort | Benefit |
|---|----------|------------|------------|------------|--------|---------|
| 1 | Exact | file1.ts:12 | file2.ts:45 | 100% | Low | High |
| 2 | Semantic | file3.ts:8 | file4.ts:22 | ~80% | Medium | Medium |

COPY-PASTE INDICATORS
| # | Pattern | Locations | Count |
|---|---------|-----------|-------|
| 1 | Magic number 86400 | file1:3, file2:7 | 2 |

TOTAL: N duplicate pairs, M copy-paste indicators

**Truncation rule**: Report top 50 findings in the message. If more than 50, write the full list to /tmp/deslop-duplicates-full.txt and note the path.
```

### integrity-scanner

```
You are an integrity scanner for the deslopper team.

**Scope**: Find cross-reference inconsistencies — phantom file refs, stale counts, config drift, broken index entries.

**Tools to use**:
- `Grep` — find file references and cross-check existence
- `Bash` — run diff-based consistency checks, count comparisons
- `Glob` — verify referenced files exist

**Process**:
1. **Phantom references**: Grep for file paths/names in config files, READMEs, and indexes. Verify each referenced file exists via Glob.
2. **Stale counts**: Find numeric claims ("N agents", "N skills", "N scripts") in docs and compare to actual counts.
3. **Cross-index consistency**: Identify parallel lists that should match (e.g., directory contents vs index arrays vs case statements). Diff them.
4. **Config drift**: Compare declared items in settings/config against actual filesystem state.

**Output format** — send this as a message to the coordinator:

INTEGRITY FINDINGS
| # | Category | Location | Issue | Severity |
|---|----------|----------|-------|----------|
| 1 | Phantom ref | README.md:45 | References scripts/foo.sh which does not exist | HIGH |
| 2 | Stale count | docs/overview.md:12 | Claims "15 agents" but 17 exist | MEDIUM |
| 3 | Index drift | lib/patterns.sh:30 | Missing case for "new-skill" | HIGH |

TOTAL: N integrity issues (X high, Y medium, Z low)

**Truncation rule**: Report top 50 findings in the message. If more than 50, write the full list to /tmp/deslop-integrity-full.txt and note the path.
```

---

**Merge Protocol**

After all scanners complete, the coordinator merges their outputs into the standard report.

### Mapping

| Scanner Output | Report Section | Action |
|----------------|---------------|--------|
| Dead code (HIGH confidence) | Auto-Fixed | Coordinator removes, then lists in report |
| Dead code (MEDIUM confidence) | Recommendations | Requires user approval |
| Duplicates (all) | Recommendations | Numbered for approval |
| Integrity issues (HIGH) | Recommendations | Numbered for approval |
| Integrity issues (MEDIUM/LOW) | Not Recommended / Documented | Informational |

### Conflict Resolution

When multiple scanners flag the same file:line — keep the **most specific** finding and discard duplicates.

| Conflict | Resolution |
|----------|------------|
| Same symbol flagged as dead AND duplicate | Keep dead code finding (more actionable) |
| Same file flagged by integrity AND duplicates | Keep both — they address different issues |
| Confidence disagreement | Use the **more conservative** (lower) confidence |

### Deduplication

Before presenting the merged report:
1. Group findings by `file:line`
2. If the same location appears from multiple scanners, keep the finding with the most specific evidence
3. Renumber all recommendations sequentially
