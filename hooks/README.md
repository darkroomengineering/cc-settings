# Native Hooks System

Claude Code has a **native hooks system** that executes shell scripts at specific events. These are configured in `settings.json`.

All hooks are **automatically installed** by the setup script. No manual configuration needed.

For the canonical event count, configuration format, matchers, and debugging:
**See [docs/hooks-reference.md](../docs/hooks-reference.md)**

## Configured Hooks

| Event | Trigger | Script | Async |
|-------|---------|--------|-------|
| `SessionStart` | New session begins | `session-start.ts` (auto-memory pointer, auto-warms TLDR) | No |
| `UserPromptSubmit` | Before Claude sees prompt | `dispatch.ts UserPromptSubmit` runs `cache-cold.ts`, `delegation-detector.ts`, `quota-steer.ts` and `escalate-model.ts` in one process. `cache-cold.ts` warns the user (`systemMessage`) when the prompt cache has expired and the context is 100K tokens or more, with the idle gap, the size, the estimated cost and a pointer to `/handoff` then `/clear`. `delegation-detector.ts` (with a TypeSafe key and `CC_TYPESAFE_PROJECT=1` in the project, Jev scores the prompt against a delegation statement and fires at probability ≥ 0.7; without a key or the opt-in, or if the call fails or times out, a regex breadth score ≥ 2 decides; names the signals via `additionalContext`) | No |
| `PreToolUse` | Before Bash, Edit, Write and Agent calls | `dispatch.ts PreToolUse` runs `safety-net.ts` (Bash; blocks destructive commands, fail-closed), `freeze-guard.ts` (Edit and Write; enforces `/freeze`), `test-protect.ts` (Bash, Edit and Write; asks before a test is skipped, deleted or renamed away), `spawn-cap.ts` (Agent; asks at a session's 30th subagent and every 15th after it; agents started by a Workflow script are not counted), `visual-proof.ts` (Bash; blocks `gh pr create`, and `gh pr edit` with a body, when the branch changes stylesheets or markup and the body has neither an image nor a "Screenshots: before/after needed" line; bodies from `--fill`, the editor, stdin, variables or `$(...)`, and edits that name another PR, are not checked), `config-guard.ts` (Bash; asks before a redirect, `tee`, `sed -i` or `perl -i` writes `.mcp.json` or a `.claude-plugin` file), `pre-edit-validate.ts` (Edit; harness optimization) and `knowledge-hint.ts` (Bash, Edit and Write; team-knowledge notes) in one process | No |
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
