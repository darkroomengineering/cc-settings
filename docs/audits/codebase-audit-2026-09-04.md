# Codebase simplification audit — 2026-09-04

NEEDS RESTRUCTURING: bounded cleanup was warranted; the installer does not need a rewrite.

| ID | Severity | Area | Confirmed finding | Resolution |
|---|---|---|---|---|
| H1 | High | Safety net | Only the last `rm -rf` operand was checked; a safe trailing operand concealed a dangerous one. | Check every operand; retain path policy. |
| H2 | High | MCP installation | Successful schema parsing stripped unknown fields from user server definitions. | Preserve the validated original map. |
| M1 | Medium | Hook auditing | A custom settings path still loaded source integrity from the default installation. | Reuse the already-resolved target directory. |
| M2 | Medium | Hook state | The parallelmax and per-tool failure counters had no readers. | Remove both writers; retain review queue and signature tracking. |
| M3 | Medium | Skill state | Nine heavy-skill marker writes across eight skills had no reader. | Remove marker instructions; retain cleanup for old artifacts. |
| M4 | Medium | Download verification | A provenance verifier always returned true; documentation overstated protection. | Delete stub/unreachable rejection; retain checksum verification and provenance TODO. |
| M5 | Medium | Instructions | Editing, review-scope, dead-code, and React directives contained conflicting or false assumptions. | Delete conflicting instructions and obsolete React Router `defer` advice. |
| L1 | Low | Installation | Aggregate detection probed unused Node package managers; bootstrap declared unused BUN_MIN. | Delete unused detection/constant. |

All findings above were traced or reproduced. Regression tests accompany H1, H2, and M1. Counter tests now check the retained behavior or absence of the intentionally removed state.

## Deletions with the largest effect

- Tool cadence now handles the review queue alone. It no longer maintains a silent streak counter on every tool invocation. Its configuration matches Bash and Agent only.
- Failure handling records signatures, logs, and ledger entries without a second unread tally.
- Skills no longer write an unread marker or explain host-specific exceptions for that marker.
- Download verification exposes the checks actually enforced instead of carrying a success-only placeholder.

## System map and coverage

Bootstrap scripts and the npm entry point select a checkout and invoke setup. Setup composes configuration, installs managed source/instructions, records ownership, and supports updates and rollback. Hook entry points use shared libraries for guards, state, telemetry, and diagnostics. The native codemap uses the TypeScript compiler. Schemas and linters validate the shipped configuration and instruction library.

Reviewed installer/lifecycle code, hooks/scripts, shared libraries, native codemap, schemas, configuration, dependency roles, and CI. Instruction review covered routing, rules, related agents, and every changed skill section. Remaining skill/profile examples and historical/reference documents received structural/reference screening, not an exhaustive prose audit. Generated files, vendored code, and node_modules were excluded from manual review.

Expected user MCP fields to survive installation; found parser-induced loss. Expected custom-path audits to inspect that installation; found mixed source directories. Expected every deletion operand to be checked; found a last-operand heuristic.

## Design tensions and rejected changes

- Ownership and rollback code is large, but its repeated checks protect changes occurring between preparation and mutation. Retained.
- Migration tombstones and old-artifact cleanup protect existing installations. Retained despite removal of current writers.
- Claude and Codex adapters share product intent but use different native mechanisms. Their separate delivery surfaces remain necessary.
- Proof hooks share some runner logic but enforce distinct boundaries. No new abstraction added.
- Smaller wrapper/empty-registry cleanups were lower value than removing whole unused paths; left alone.
- The four direct dependencies have distinct roles: Zod validation, TypeScript compilation/analysis, Bun types, and Biome. No dependency was added or upgraded; registry currency was not reassessed.
- No SLSA/cosign implementation was added. The pre-existing TODO remains open; checksum verification is the actual enforced boundary.

## Evidence and limits

The safety-net reproduction passed command text to the hook only; no destructive command ran. MCP and audit-path reproductions used temporary fixture installations. Existing shell-tokenization limitations remain; this is not a complete shell parser.

The deleted React state-consolidation rule contradicted [React's batching documentation](https://react.dev/learn/queueing-a-series-of-state-updates). The streaming examples now use the existing promise-return pattern described in [React Router's documentation](https://reactrouter.com/how-to/suspense).

Final verification: **1,833 tests passed, zero failed**, across 81 files. Typecheck, Biome, skill/agent/profile/shortcut/link linting, and schema freshness passed. Research lint found no RESEARCH.md files to inspect. There is no separate build script; this repository runs TypeScript directly with Bun. Independent cleanup and security-fix reviews found no blocking issues.

The first test run encountered host-environment failures: NO_COLOR suppressed expected ANSI output, the sandbox blocked a localhost fixture server, and Git invoked the host signing service. The complete successful run removed NO_COLOR, disabled commit signing through process-local Git configuration, and allowed the local fixture server to bind. No assertions were weakened to resolve these failures. No tests were skipped or marked .only. Tests of deliberately deleted counters were replaced with checks of retained signatures and absence of unused state.

Real user installations, production downloads, launchd registration, Windows/PowerShell execution, and live Claude/Codex sessions were not exercised. The install tests use temporary homes and fixtures. No external team-knowledge corpus was consulted.

## Open questions

None blocks these bounded changes. A complete shell parser or real provenance verification would need a separate implementation scope.
