# Hooks Reference

Complete reference for Claude Code hook events, configuration, and debugging.

---

## Overview

Hooks are TypeScript scripts (executed via Bun) that run at specific points in the Claude Code lifecycle. They are configured in `settings.json` under the `hooks` key and are installed automatically by `setup.sh`.

Hooks can validate input, block operations, inject context, log activity, and trigger side effects.

---

## Hook Events (29 total)

### Session Lifecycle

| Event | When | Matcher Values | Blocking |
|-------|------|----------------|----------|
| `SessionStart` | Session begins (new, resume, compact, clear) | `startup`, `resume`, `clear`, `compact` | Yes |
| `SessionEnd` | Session is ending | -- | No (always async) |
| `Setup` | Triggered via `--init`, `--init-only`, or `--maintenance` CLI flags | -- | Yes |

### User Interaction

| Event | When | Matcher Values | Blocking |
|-------|------|----------------|----------|
| `UserPromptSubmit` | User submits a prompt, before Claude sees it | -- | Yes |
| `UserPromptExpansion` | User prompt expansion events (e.g., skill or template expansion) | -- | Yes |
| `Notification` | Claude sends a notification to the user | Notification type | No |
| `Stop` | Claude finishes generating a response | -- | Yes |
| `StopFailure` | Turn ends due to API error (rate limit, auth failure) | -- | No |

### Tool Lifecycle

| Event | When | Matcher Values | Blocking |
|-------|------|----------------|----------|
| `PreToolUse` | Before a tool executes | Tool name (e.g., `Bash`, `Edit`, `Write`) | Yes |
| `PostToolUse` | After a tool executes successfully | Tool name | Optional (supports async) |
| `PostToolBatch` | After a batch of tool calls completes | -- | No |
| `PostToolUseFailure` | After a tool execution fails | Tool name | Optional |
| `PermissionRequest` | When a tool needs user permission | Tool name | Yes |
| `PermissionDenied` | After auto mode classifier denies a tool | Tool name | No |

### Agent Lifecycle

| Event | When | Matcher Values | Blocking |
|-------|------|----------------|----------|
| `SubagentStart` | A subagent spawns | Agent type (e.g., `explore`, `planner`) |  No |
| `SubagentStop` | A subagent finishes | Agent type | No |
| `TeammateIdle` | An Agent Teams teammate goes idle | -- | No |
| `TaskCompleted` | A task is marked completed | -- | No |
| `TaskCreated` | A task is created via `TaskCreate` | -- | No |

### Environment Events

| Event | When | Matcher Values | Blocking |
|-------|------|----------------|----------|
| `CwdChanged` | Working directory changes during session | -- | No |
| `FileChanged` | A watched file changes on disk | -- | No |

### Context Management

| Event | When | Matcher Values | Blocking |
|-------|------|----------------|----------|
| `PreCompact` | Before context compaction | `manual` or `auto` | Yes |
| `PostCompact` | After context compaction completes | -- | No |
| `InstructionsLoaded` | CLAUDE.md or `.claude/rules/*.md` loaded | -- | No |
| `ConfigChange` | Configuration file changes during session | `user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills` | Yes |

### MCP Events

| Event | When | Matcher Values | Blocking |
|-------|------|----------------|----------|
| `Elicitation` | MCP server requests structured user input mid-task | -- | Yes |
| `ElicitationResult` | User responds to MCP elicitation dialog | -- | No |

### Worktree Events

| Event | When | Matcher Values | Blocking |
|-------|------|----------------|----------|
| `WorktreeCreate` | Worktree being created (can replace default git behavior) | -- | Yes |
| `WorktreeRemove` | Worktree being removed | -- | No |

---

## Environment Variables

Each hook event has access to different environment variables.

### Universal Variables

Available in all hooks:

| Variable | Description |
|----------|-------------|
| `$HOME` | User home directory |
| `$PWD` | Current working directory |

### Event-Specific Variables

| Event | Variable | Description |
|-------|----------|-------------|
| `UserPromptSubmit` | `$PROMPT` | The user's prompt text |
| `PreToolUse` | `$TOOL_NAME` | Name of the tool about to execute |
| `PreToolUse` | `$TOOL_INPUT` | JSON string of tool input parameters |
| `PostToolUse` | `$TOOL_NAME` | Name of the tool that executed |
| `PostToolUse` | stdin (JSON) | Full hook context: `tool_input`, `tool_response`, `tool_name`, `session_id`, `cwd`, `duration_ms` |
| `PostToolUse` | `duration_ms` (JSON) | Tool execution time in ms, excluding permission prompts and PreToolUse (v2.1.119) |
| `PostToolUseFailure` | `$TOOL_NAME` | Name of the tool that failed |
| `PostToolUseFailure` | `$TOOL_ERROR` | Error message from the failure |
| `PostToolUseFailure` | `duration_ms` (JSON stdin) | Tool execution time in ms up to failure point (v2.1.119) |
| `SubagentStart` | `$AGENT_ID` | Unique identifier for the subagent |
| `SubagentStart` | `$AGENT_TYPE` | Agent type (e.g., `explore`, `planner`) |
| `SubagentStop` | `$AGENT_ID` | Unique identifier for the subagent |
| `SubagentStop` | `$AGENT_TYPE` | Agent type (e.g., `explore`, `planner`) |
| `Notification` | `$NOTIFICATION_MESSAGE` | The notification text |
| `PermissionDenied` | `$TOOL_NAME` | Name of the tool that was denied |
| `PermissionDenied` | `$PERMISSION_DECISION_REASON` | Reason for the denial |
| _all events_ | `$CLAUDE_EFFORT` | Active effort level (`low`, `medium`, `high`, `xhigh`, `max`) — also available to Bash tool subprocesses (v2.1.133) |

### Effort Level in JSON Input

As of v2.1.133, hooks that receive JSON on stdin also see the active effort level under `effort.level`:

```json
{
  "session_id": "…",
  "cwd": "…",
  "tool_input": { /* … */ },
  "effort": { "level": "xhigh" }
}
```

Use this when a hook should change behavior based on effort — e.g., skip an expensive lint pass on `low`, run a stricter validator on `max`.

### Flattened Tool Input Variables

For `PreToolUse` hooks, Claude Code also provides **flattened** versions of the `$TOOL_INPUT` JSON object as individual environment variables. **Note: these are NOT available in `PostToolUse` hooks** — PostToolUse receives data on stdin instead. Each top-level key in the tool input becomes `TOOL_INPUT_<key>`.

This is more convenient than parsing the raw `$TOOL_INPUT` JSON string in shell scripts.

| Variable | Available In | Description |
|----------|-------------|-------------|
| `TOOL_INPUT_command` | `PreToolUse(Bash)`, `PostToolUse(Bash)` | The shell command being executed |
| `TOOL_INPUT_file_path` | `PreToolUse(Edit)`, `PostToolUse(Write\|Edit)` | The file path being written or edited |

**Example usage in a hook script:**

```bash
#!/usr/bin/env bash
# Access the file path directly instead of parsing $TOOL_INPUT JSON
FILE_PATH="${TOOL_INPUT_file_path:-}"
[[ -z "$FILE_PATH" ]] && exit 0

# Now use $FILE_PATH directly
echo "Edited file: $FILE_PATH"
```

The flattened variables follow the naming convention `TOOL_INPUT_<key>` where `<key>` matches the parameter name from the tool's input schema (e.g., `file_path`, `command`, `old_string`, `new_string`, `pattern`).

---

## Hook Configuration Format

### Basic Structure

```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "Pattern",
        "hooks": [
          {
            "type": "command",
            "command": "bash /path/to/script.sh",
            "async": false,
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

### Hook Entry Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `matcher` | string | -- | Filter which tools/events trigger the hook (see Matcher Patterns below) |
| `if` | string | -- | Conditional filter using permission rule syntax (e.g., `"Bash(git commit*)"`, `"Bash(bun add*) Bash(npm install*)"`) — more precise than `matcher` for command-level filtering |
| `hooks` | list | (required) | Array of hook actions to execute |

**`if` vs `matcher`**: Use `matcher` to filter by tool name (`"Bash"`, `"Edit"`, `"Write|Edit"`). Use `if` to filter by specific command patterns within a tool, avoiding the need for shell-script grep matching. Space-separated patterns are OR'd together.

### Hook Action Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | string | (required) | `"command"` (shell), `"prompt"` (LLM yes/no), `"agent"` (subagent with tools), or `"http"` (webhook) |
| `command` | string | (required for command type) | Shell command to execute |
| `args` | string[] | -- | (v2.1.139, `command` type) Exec form. When set, CC spawns `command` directly with this argv — no shell. Safer for paths with spaces; no quoting needed in `command`. |
| `async` | boolean | `false` | Run in background without blocking Claude |
| `timeout` | number | `600` | Timeout in seconds (max: 600) |
| `once` | boolean | `false` | Run exactly once per session, then disable |
| `continueOnBlock` | boolean | `false` | (v2.1.139, `PostToolUse` only) When the hook returns a block signal, the turn continues — the block surfaces in context but doesn't abort. Use for soft warnings. |
| `terminalSequence` | string | -- | (v2.1.141, hook output) Raw terminal escape sequence the hook returns in its JSON output. Lets hooks emit desktop notifications, set window titles, or ring the bell without owning a controlling terminal. |

### Hook Types

| Type | Description | Use For |
|------|-------------|---------|
| `command` | Executes a shell command. Exit code 0 = pass, non-zero = block (for PreToolUse). stdout is injected into Claude's context. | Validation, logging, context injection |
| `prompt` | Sends a single-turn prompt to Claude for yes/no evaluation. | Complex validation requiring LLM judgment |
| `agent` | Spawns a subagent with tool access (Read, Grep, Glob) for verification. | Multi-step validation requiring code inspection |
| `http` | Sends a webhook to a URL. Configure with `url`, `headers`, `allowedEnvVars`. Controlled by `allowedHttpHookUrls` setting. | Remote validation, external integrations, audit logging |

---

## Matcher Patterns

Matchers filter which specific tool invocations or events trigger a hook.

### Syntax

| Pattern | Matches | Example |
|---------|---------|---------|
| Exact name | Single tool | `"Bash"` |
| Pipe-separated | Multiple tools | `"Write\|Edit"` |
| No matcher | All invocations of that event | (omit `matcher` field) |

### Common Matcher Values for PreToolUse/PostToolUse

| Matcher | Triggers On |
|---------|-------------|
| `Bash` | Any shell command execution |
| `Write` | File write operations |
| `Edit` | File edit operations |
| `Write\|Edit` | Either writes or edits |
| `Read` | File read operations |

### Matcher Values for SubagentStart/SubagentStop

| Matcher | Description |
|---------|-------------|
| `Explore` | Built-in exploration agent |
| `Plan` | Built-in planning agent |
| `general-purpose` | Built-in multi-step agent |
| `Bash` | Shell command subagent |
| `<custom>` | Custom agent names from `agents/*.md` |

### Matcher Values for SessionStart

| Matcher | Description |
|---------|-------------|
| `startup` | Fresh session start |
| `resume` | Resuming a previous session |
| `clear` | Session cleared |
| `compact` | Session compacted |

### Matcher Values for PreCompact

| Matcher | Description |
|---------|-------------|
| `manual` | User triggered compaction |
| `auto` | Automatic compaction (context threshold) |

### Matcher Values for Notification

| Matcher | Description |
|---------|-------------|
| `agent_needs_input` | Background agent (`claude agents`) session is waiting for input (v2.1.198) |
| `agent_completed` | Background agent (`claude agents`) session finished (v2.1.198) |
| (omit) | All notification types, including permission prompts |

---

## Sync vs Async Behavior

### Synchronous (default)

- Hook runs and Claude **waits** for completion before proceeding.
- Hook stdout is injected into Claude's context as a system message.
- Non-zero exit code from `PreToolUse` hooks **blocks** the tool execution.
- Use for: validation, context injection, blocking checks.

### Asynchronous (`async: true`)

- Hook runs in the background. Claude **does not wait**.
- Output is not injected into context.
- Cannot block operations.
- Use for: logging, metrics, notifications, cleanup.

### Decision Guide

| Need | Use |
|------|-----|
| Block dangerous commands | Sync `PreToolUse` |
| Inject context before Claude sees prompt | Sync `UserPromptSubmit` |
| Auto-format after edit | Sync `PostToolUse` |
| Log agent activity | Async `SubagentStart`/`SubagentStop` |
| Send desktop notification | Async `Notification` |
| Track usage metrics | Async `PostToolUse` |
| Save state before compaction | Sync `PreCompact` |
| Session cleanup | Async `SessionEnd` |

---

## Configured Hooks

### SessionStart

| Script | Purpose | Async |
|--------|---------|-------|
| `verify-hooks.ts` | Validates the hooks-block fingerprint on session start; warns on tampering | No |
| `session-start.ts` | Surfaces auto-memory pointer, auto-warms TLDR index | No |
| `codex-verify.ts` | Cheap Codex CLI availability check (`codex login status`) for the statusline badge; persists the verdict to `~/.claude/tmp/codex-verdict.json`. Silent on success and error, fail-open | Yes |

### UserPromptSubmit

| Script | Purpose | Async |
|--------|---------|-------|
| `session-title.ts` | Derives session title from first prompt; emits `hookSpecificOutput.sessionTitle` so `claude --resume <name>` works | Yes |
| `delegation-detector.ts` | Regex-scores incoming prompt for breadth signals (phrases like "do all", "across the repo", path-shaped tokens, large numbered lists). At score ≥ 2, injects a compact `additionalContext` reminder: score, matched signals, and a one-line routing guide (maestro / implementer / parallel agents in ONE message). Overriding requires a stated reason. | No |
| `quota-steer.ts` | Reads the statusline's cached rate-limit percentages; injects quota-aware model-routing guidance (Codex bridge / Sonnet downshift) once usage crosses elevated/critical thresholds. Fail-open | No |

> Note: Since v2.1.108 Claude Code has a native `Skill` tool that auto-matches skills; the old `skill-activation` hook was removed. Correction detection was removed as low-signal.

### PreToolUse (Bash matcher)

| Script | Purpose | Async |
|--------|---------|-------|
| `safety-net.ts` | Blocks destructive shell commands (rm -rf /, force push, etc.) | No |
| Inline pre-commit tsc check | Runs `tsc --noEmit` before any `git commit` command. Blocks commit if TypeScript errors found | No |
| `check-docs-before-install.ts` | Reminds to fetch docs before installing new packages | No |

### PreToolUse (Edit matcher)

| Script | Purpose | Async |
|--------|---------|-------|
| `pre-edit-validate.ts` | Validates edit strategy (file recently read, edit size appropriate) | No |

### PreToolUse (Edit|Write matcher)

| Script | Purpose | Async |
|--------|---------|-------|
| `freeze-guard.ts` | When a `/freeze` boundary is active, blocks Edit/Write calls targeting any file outside the locked directory | No |

### PostToolUse (Write|Edit matcher)

| Script | Purpose | Async |
|--------|---------|-------|
| `post-edit.ts` | Auto-formats edited files with Biome | No |
| `post-edit-tsc.ts` | Runs TypeScript type check on edited files | Yes |
| `promote-memory.ts` | Nudges (once per file) when a team-relevant auto-memory file is written under `.../memory/`, for `project`/`feedback` memory types | No |

### PostToolUse (Bash matcher — command logging)

| Script | Purpose | Async |
|--------|---------|-------|
| `log-bash.ts` | Logs every Bash command to `~/.claude/logs/bash-YYYY-MM-DD.log` | Yes |

Logs are used by `bun run claude-audit` to analyze command patterns, security concerns, and repeated commands. Hook receives JSON on stdin with `tool_input.command`.

**Log format:** `[HH:MM:SS] [project] command`

**Retention:** Controlled by `CLAUDE_LOG_RETENTION_DAYS` env var (default: 1 day, today only). Old logs are pruned automatically on each hook fire.

### PostToolUse (no matcher — every tool)

| Script | Purpose | Async |
|--------|---------|-------|
| `tool-cadence.ts` (parallelmax branch) | Counts consecutive non-Agent tool calls and distinct file edits per streak. **One nudge per streak**: fires at threshold 12 calls OR 3+ files edited — emits a compact `additionalContext` reminder with the delegation heuristic. **One escalation per streak**: if the streak continues past the nudge by another threshold-worth of calls or 2+ more files, emits a soft block (`continueOnBlock: true`) via `blockDecision` — the turn continues but the signal is hard to ignore. Both signals suppress when the review queue is at capacity. Resets on any Agent call. 60s debounce. State at `~/.claude/tmp/parallelmax-counter.json`. `CC_PARALLELMAX_THRESHOLD` env override (default 12). | No |

### PostToolUseFailure

| Script | Purpose | Async |
|--------|---------|-------|
| `post-failure.ts` | Logs tool failures, warns if same tool fails 3+ times in a session | No |

### PreCompact

| Script | Purpose | Async |
|--------|---------|-------|
| `handoff.ts create` | Saves current task state to handoff file before context is compacted | No |

### PostCompact

| Script | Purpose | Async |
|--------|---------|-------|
| `post-compact.ts` | Injects recovery steps (re-read plan, key files, check TaskList) and surfaces latest handoff path | No |

### Stop

| Script | Purpose | Async |
|--------|---------|-------|
| `stop-summary.ts` | End-of-turn summary; if >5 files were changed, reminds to store learnings | No |

> **v2.1.163:** `Stop` and `SubagentStop` hooks may return `hookSpecificOutput.additionalContext` to feed text back to Claude and keep the turn going — it surfaces as context rather than being treated as a hook error.

### StopFailure

| Script | Purpose | Async |
|--------|---------|-------|
| `stop-failure.ts` | Logs API errors to `~/.claude/api-failures.log`; surfaces rate limit guidance on 429/capacity errors | No |

### SubagentStart / SubagentStop / TaskCreated / TaskCompleted

| Script | Purpose | Async |
|--------|---------|-------|
| Log to `~/.claude/swarm.log` | Records agent spawn/stop events with agent type and ID; logs task creation and completion with subject | Yes |

### Notification

| Script | Purpose | Async |
|--------|---------|-------|
| `notify.ts` | Sends desktop notification (macOS/Linux) when tasks complete | Yes |

### SessionEnd

| Script | Purpose | Async |
|--------|---------|-------|
| `handoff.ts create` | Saves final handoff state at session end | Yes |

### CwdChanged

| Script | Purpose | Async |
|--------|---------|-------|
| `cwd-changed.ts` | Surfaces project context (CLAUDE.md size, recent commits, branch, untracked files) when the working directory changes mid-session | Yes |

---

## Adding New Hooks

cc-settings hooks are TypeScript executed by Bun (since v8.0.0). Land the script under `src/scripts/` or `src/hooks/` in the repo — the installer copies it to `~/.claude/src/...`.

### Step 1: Create the Script

```ts
#!/usr/bin/env bun
// src/scripts/my-hook.ts — description of what this hook does

const toolName = process.env.TOOL_NAME ?? "";
if (!toolName) process.exit(0);

console.log(`[Hook] Processing: ${toolName}`);

// Exit 0 to allow, non-zero to block (PreToolUse only).
// To emit structured hook output, write a JSON object to stdout:
//   console.log(JSON.stringify({ hookSpecificOutput: { sessionTitle: "…" } }));

export {};
```

### Step 2: Register in `settings.json`

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "bun \"$HOME/.claude/src/scripts/my-hook.ts\"",
            "async": true,
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### Step 3: Test

Run a Claude Code session and trigger the relevant event. Check logs for output (see "Debugging Hooks" below).

### Best Practices

- **Use the shared runtime.** Import from `src/lib/hook-runtime.ts` — `readHookInput<T>()` (reads stdin JSON with env-var fallback), `readState<T>(name, fallback)` / `writeState(name, data)` (atomic IO against `~/.claude/tmp/<name>.json`), and `runHook(main)` (top-level fail-open wrapper). The cadence hooks (`tool-cadence.ts`, `delegation-detector.ts`) are the reference implementations.
- Always quote `$HOME` paths in the `command` string.
- Use `async: true` for non-blocking operations (logging, metrics).
- Set reasonable `timeout` values (default 600s is often too long for simple scripts).
- For `PreToolUse` hooks: exit 0 means allow, exit 2 means block (output JSON with `{"decision":"block","reason":"..."}`). Include a clear message explaining why.
- Write to log files for debugging rather than relying on stdout for async hooks.

---

## Debugging Hooks

### Log Locations

| Log File | Contents |
|----------|----------|
| `~/.claude/hooks.log` | General hook execution output |
| `~/.claude/swarm.log` | Subagent start/stop and task created/completed events |
| `~/.claude/sessions.log` | Session lifecycle events |
| `~/.claude/session-titles/` | Per-session title flags (set once per session by `session-title.ts`) |
| `~/.claude/logs/tool-failures.log` | Tool failure events (from `post-failure.ts`) |
| `~/.claude/safety-net.log` | Blocked command audit log (from `safety-net.ts`) |
| `~/.claude/logs/bash-*.log` | Daily Bash command logs (from `log-bash.ts`) |

### Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Hook never fires | Wrong `matcher` value | Check tool name spelling; use `Write\|Edit` not `Write, Edit` |
| Hook fires but no effect | Script not executable | Run `chmod +x` on the script |
| Hook blocks unexpectedly | Script exits non-zero | Add error handling; check exit codes |
| Hook output not visible | Hook is async | Async hooks don't inject into context; switch to sync if needed |
| Hook causes timeout | Script hangs | Add timeout to the script itself; reduce `timeout` value |
| `$TOOL_INPUT` is empty | Wrong event | `TOOL_INPUT` is only available in `PreToolUse` and `PostToolUse` |
| Path not found | Missing quotes | Always quote the path: `bun "$HOME/.claude/src/scripts/..."` (or `src/hooks/...`) |

### Testing a Hook Manually

```bash
# Simulate PreToolUse environment
export TOOL_NAME="Bash"
export TOOL_INPUT='{"command":"git commit -m test"}'
bun ~/.claude/src/hooks/safety-net.ts

# Check exit code
echo $?  # 0 = allow, 1 = block
```

### Monitoring Live Hook Activity

```bash
# Watch swarm/agent activity
tail -f ~/.claude/swarm.log

# Watch all hook-related logs
tail -f ~/.claude/hooks.log

# List handoff files
ls -lt ~/.claude/handoffs/*.md | head -5
```
