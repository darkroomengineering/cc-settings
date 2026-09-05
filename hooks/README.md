# Native Hooks System

Claude Code has a **native hooks system** that executes shell scripts at specific events. These are configured in `settings.json`.

All hooks are **automatically installed** by the setup script. No manual configuration needed.

For the canonical event count, configuration format, matchers, and debugging:
**See [docs/hooks-reference.md](../docs/hooks-reference.md)**

## Configured Hooks

| Event | Trigger | Script | Async |
|-------|---------|--------|-------|
| `SessionStart` | New session begins | `session-start.ts` (auto-memory pointer, auto-warms TLDR) | No |
| `UserPromptSubmit` | Before Claude sees prompt | `session-title.ts` (sets session title from prompt for `--resume`) | **Yes** |
| `UserPromptSubmit` | Before Claude sees prompt | `delegation-detector.ts` (regex-scores prompt for breadth signals; at score ≥ 2 injects delegation reminder via `additionalContext`) | No |
| `PreToolUse` | Before Bash commands (Bash matcher) | `safety-net.ts` (blocks destructive commands) | No |
| `PreToolUse` | Before git commit (Bash matcher) | Pre-commit tsc check (TypeScript validation) | No |
| `PreToolUse` | Before package install (Bash matcher) | `check-docs-before-install.ts` (doc-fetch reminder) | No |
| `PreToolUse` | Before Edit calls (Edit matcher) | `pre-edit-validate.ts` (harness optimization) | No |
| `PostToolUse` | After Write/Edit | `post-edit.ts` (auto-format with Biome) | No |
| `PostToolUse` | After Write/Edit | `post-edit-tsc.ts` (async TypeScript type check) | **Yes** |
| `PostToolUse` | After Bash commands | `log-bash.ts` (command audit log) | **Yes** |
| `PostToolUse` | After Bash or Agent calls | `tool-cadence.ts` (review-queue backpressure) | No |
| `PostToolUseFailure` | Tool execution fails | `post-failure.ts` (logs failures, warns on repeats, records the exact tool+error in the session ledger) | No |
| `PostToolBatch` | After a batch of tool calls resolves | `ledger-record.ts` (records read/changed file paths in the session ledger — metadata only) | **Yes** |
| `PreCompact` | Before context compaction | `handoff.ts create --from-hook` (saves state + session provenance) | No |
| `PostCompact` | After context compaction | `post-compact.ts` (persists `compact_summary` into the matching handoff — stdout is user-visible only, never injected) | No |
| `Stop` | Claude finishes | `stop-summary.ts` (learning reminder if >5 files changed) | No |
| `StopFailure` | Turn ends due to API error | `stop-failure.ts` (logs, surfaces rate limit info) | No |
| `SessionEnd` | Session ending | `handoff.ts create --from-hook` | **Yes** |
| `SubagentStart` | Subagent spawns | Logs to `~/.claude/swarm.log` | **Yes** |
| `SubagentStop` | Subagent finishes | Logs to `~/.claude/swarm.log` | **Yes** |
| `Notification` | Task completion | `notify.ts` (macOS/Linux notification) | **Yes** |
| `TaskCreated` | Task created via TaskCreate | Logs to `~/.claude/swarm.log` | **Yes** |
| `TaskCompleted` | Task marked completed | `swarm-log.ts complete` | **Yes** |

## Behavioral Guidelines

The following markdown files describe **behavioral guidelines** referenced by skills and agents:

| File | Referenced By |
|------|--------------|
| `checkpoint.md` | `skills/orchestrate/` (phased execution variant), `agents/maestro.md` |
| `verification-check.md` | `skills/orchestrate/` (phased execution variant) |
