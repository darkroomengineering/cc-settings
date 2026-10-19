# Native Hooks System

Claude Code has a **native hooks system** that executes shell scripts at specific events. These are configured in `settings.json`.

All hooks are **automatically installed** by the setup script. No manual configuration needed.

For the canonical event count, configuration format, matchers, and debugging:
**See [docs/hooks-reference.md](../docs/hooks-reference.md)**

## Configured Hooks

| Event | Trigger | Script | Async |
|-------|---------|--------|-------|
| `SessionStart` | New session begins | `session-start.ts` (auto-memory pointer, auto-warms TLDR) | No |
| `UserPromptSubmit` | Before Claude sees prompt | `dispatch.ts UserPromptSubmit` runs `delegation-detector.ts`, `quota-steer.ts` and `escalate-model.ts` in one process. `delegation-detector.ts` (with a TypeSafe key and `CC_TYPESAFE_PROJECT=1` in the project, Jev scores the prompt against a delegation statement and fires at probability ≥ 0.7; without a key or the opt-in, or if the call fails or times out, a regex breadth score ≥ 2 decides; names the signals via `additionalContext`) | No |
| `PreToolUse` | Before Bash, Edit and Write calls | `dispatch.ts PreToolUse` runs `safety-net.ts` (Bash; blocks destructive commands, fail-closed), `pre-edit-validate.ts` (Edit; harness optimization), `freeze-guard.ts` (Edit and Write; enforces `/freeze`) and `knowledge-hint.ts` (Bash, Edit and Write; team-knowledge notes) in one process | No |
| `PreToolUse` | Before package install (Bash matcher) | `check-docs-before-install.ts` (doc-fetch reminder) | No |
| `PostToolUse` | After Write, Edit, Bash and Agent calls | `dispatch.ts PostToolUse` runs `post-edit.ts` (Write and Edit; auto-format with Biome), `tool-cadence.ts` (Bash and Agent; review-queue backpressure), `promote-memory.ts` (Write and Edit; share-learning nudge) and `escalate-acted.ts` (Agent; escalation telemetry) in one process | No |
| `PostToolUse` | After Write/Edit | `post-edit-tsc.ts` (async TypeScript type check) | **Yes** |
| `PostToolUse` | After Bash commands | `log-bash.ts` (command audit log) | **Yes** |
| `PostToolUseFailure` | Tool execution fails | `post-failure.ts` (logs failures, warns on repeats, records the exact tool+error in the session ledger) | No |
| `PostToolBatch` | After a batch of tool calls resolves | `ledger-record.ts` (records read/changed file paths in the session ledger — metadata only) | **Yes** |
| `PreCompact` | Before context compaction | `handoff.ts create --from-hook` (saves state + session provenance) | No |
| `PostCompact` | After context compaction | `post-compact.ts` (persists `compact_summary` into the matching handoff — stdout is user-visible only, never injected) | No |
| `Stop` | Claude finishes | `ask-gate.ts` (blocks a turn that ends in a prose question without `AskUserQuestion`) | No |
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
| `verification-check.md` | `skills/orchestrate/` (phased execution variant) |
