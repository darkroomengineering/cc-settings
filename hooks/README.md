# Native Hooks System

Claude Code has a **native hooks system** that executes shell scripts at specific events. These are configured in `settings.json`.

All hooks are **automatically installed** by the setup script. No manual configuration needed.

For full hook documentation (all 14 events, configuration format, matchers, debugging):
**See [docs/hooks-reference.md](../docs/hooks-reference.md)**

## Configured Hooks

| Event | Trigger | Script | Async |
|-------|---------|--------|-------|
| `UserPromptSubmit` | Before Claude sees prompt | `skill-activation.sh` (skill matching) | No |
| `UserPromptSubmit` | On user correction | Correction detection (learning reminder) | No |
| `SessionStart` | New session begins | `session-start.sh` (recalls learnings, auto-warms TLDR) | No |
| `PreToolUse` | Before Bash commands (Bash matcher) | `safety-net.sh` (blocks destructive commands) | No |
| `PreToolUse` | Before git commit (Bash matcher) | Pre-commit tsc check (TypeScript validation) | No |
| `PreToolUse` | Before package install (Bash matcher) | `check-docs-before-install.sh` (doc-fetch reminder) | No |
| `PreToolUse` | Before Edit calls (Edit matcher) | `pre-edit-validate.sh` (harness optimization) | No |
| `PostToolUse` | After Write/Edit | `post-edit.sh` (auto-format with Biome) | No |
| `PostToolUse` | After Edit | Async tsc check (TypeScript type errors) | **Yes** |
| `PostToolUse` | After TLDR MCP calls | `track-tldr.sh` (usage stats) | **Yes** |
| `PreCompact` | Before context compaction | `handoff.sh create` (saves state) | No |
| `SessionEnd` | Session ending | `tldr-stats.sh` + `handoff.sh create` | **Yes** |
| `Stop` | Claude finishes | Learning reminder if >5 files changed | No |
| `SubagentStart` | Subagent spawns | Logs to `~/.claude/swarm.log` | **Yes** |
| `SubagentStop` | Subagent finishes | Logs to `~/.claude/swarm.log` | **Yes** |
| `Notification` | Task completion | `notify.sh` (macOS/Linux notification) | **Yes** |

## Behavioral Guidelines

The following markdown files describe **behavioral guidelines** referenced by skills and agents:

| File | Referenced By |
|------|--------------|
| `checkpoint.md` | `skills/l-thread/`, `agents/maestro.md` |
| `verification-check.md` | `skills/l-thread/` |
