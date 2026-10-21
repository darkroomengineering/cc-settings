# Hooks Reference

Complete reference for Claude Code hook events, configuration, and debugging.

---

## Overview

Hooks are TypeScript scripts (executed via Bun) that run at specific points in the Claude Code lifecycle. They are configured in `settings.json` under the `hooks` key and are installed automatically by `setup.sh`.

Hooks can validate input, block operations, inject context, log activity, and trigger side effects.

---

## Function hooks (early access)

A second, separate hook surface: a plugin's TypeScript module registers handlers directly on Claude Code's engine (`on("session.compact", async ($, event, next) => ...)`), rather than the classic hook events below (shell/TS scripts matched by event name in `settings.json`). It is early access, gated behind `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` (Claude Code 2.1.274+) — cc-settings sets this env var unconditionally in `config/10-core.json`, since both plugins below fall back to native behavior when nothing keys them.

cc-settings ships four plugins through this surface, all declared in `.claude-plugin/marketplace.json` and enabled via `config/10-core.json`'s `enabledPlugins`:

- **`fast-jev-compaction@fast-jev-compaction`** — upstream [tamaratran/fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction), pinned to commit `e3f262a7f4d42bd8dd32ced30d26176f7cb545b0` (v0.3.0) via `extraKnownMarketplaces`. On `session.compact`, it asks a TypeSafe "Jev" model which tool calls/results in the transcript are still needed and drops the rest, leaving user and assistant text untouched — a smaller context without a lossy summary. It needs a `TYPESAFE_API_KEY` (the installer writes it into the settings `env` block; a shell env var also works; never committed); without one, or on any Jev failure, it logs a fallback line and defers to Claude Code's native summary compaction. `pluginConfigs` sets its `compactAtPercent` to `100` — see the next plugin for why.
- **`compaction-trigger@cc-settings`** — cc-settings' own plugin, `plugins/compaction-trigger/`. Upstream's own `turn.complete` hook requests a compaction at 60% of the model's context window by default; on a 200K+ window model that fires far more often than cc-settings' own ~150K working-context ceiling calls for (see `CLAUDE-FULL.md` "Effort and context"). Setting `fast-jev-compaction`'s `compactAtPercent` to 100 disables its own trigger, and `compaction-trigger` requests the compaction instead, once `$.session.usage()` reports `context.tokens` past its own `compactAtTokens` option (default 150,000), waiting at least `minTurnsBetween` turns (default 3) between requests. Since 15.22.0 (plugin 0.2.0) it also copies `TYPESAFE_API_KEY` from the settings `env` block into the process env right before each request, so a key rotated after the session started no longer leaves the verbatim plugin sending the stale one and falling back to the built-in summary on a 401 for the rest of the session. Since 15.25.0 (plugin 0.3.0) it also hooks `ui.log`: fast-jev-compaction's per-item `decisions:` dump, which has no option to silence it, is rewritten to the debug log with `next({ ...e, to: "debug" })`, so the transcript keeps only the `kept N/M messages` summary. That works because a `$.ui.log` from a plugin seated beneath is a dispatch the hooks above it see.
- **`context-report@cc-settings`** — cc-settings' own plugin, `plugins/context-report/`. Hooks `prompt.context` and, after `next()` has run (the built-in `agents-md` mod sits beneath it and adds a project's `AGENTS.md` inside `next`), reports the `instructionFiles` the engine put behind the `claudeMd` block: one transcript line per context load such as `Instructions loaded (6 files, 79.5 KB): user ~/.claude/CLAUDE.md +@AGENTS.md · project ./AGENTS.md ./.claude/AGENTS.md · memory 1`, where `+@name` marks a file an `@` import pulled in. Two hints ride on the same facts: a project-tier `CLAUDE.md` or `CLAUDE.local.md` (which keeps the project's `AGENTS.md` from loading; it names `/cc migrate` and says rename or merge depending on whether an `AGENTS.md` exists), and a user `CLAUDE.md` with no `@AGENTS.md` import (rerun `setup.sh`). Headless (`-p`, SDK) sessions get the lines in the debug log instead. It replaced the classic SessionStart banner's `Standards:` guesses, which read the filesystem and could not see imports or the native read. Its kit tests under `plugins/context-report/tests/` are for `claude plugin test`, which the 2.1.277 public build does not ship yet; `bun test` covers the pure `report()`.
- **`drift-fuse@cc-settings`** — cc-settings' own plugin, `plugins/drift-fuse/`. Keeps the person's prompts as the task contract (a long one replaces it, a short one or a slash command is appended), records each main-loop turn's edits, writes and Bash command heads, and when the turn ends asks Jev one `noul` question: did this turn serve that task. Two consecutive turns under `driftBelow` (0.35) trip the fuse; the next prompt no person typed (a `/loop` wakeup, a routine, a task notification, an SDK turn) gets one context line naming the task and the last turn's actions (`onTrip: "redirect"`) or is dropped (`onTrip: "pause"`). A person's prompt always passes and resets both. Scores only turns started by a non-person prompt unless `scope` is `all`. Needs `TYPESAFE_API_KEY` and the project's `CC_TYPESAFE_PROJECT=1` opt-in (see [TypeSafe: what is sent](#typesafe-what-is-sent-and-the-per-project-opt-in)); without either, or on any Jev failure or 2.5 s timeout, nothing is scored. In an opted-in project the contract prompt, file paths, command heads and the head of the answer leave the machine for each scored turn. Options: `driftBelow`, `tripAfter` (2), `onTrip`, `scope`.

### TypeSafe: what is sent, and the per-project opt-in

A TypeSafe key sends session content to `api.typesafe.ai`, a third party. On client work that can break an NDA, so cc-settings' own senders stay silent in a project until that project opts in.

| Sender | What leaves the machine | Gated by `CC_TYPESAFE_PROJECT` |
|---|---|---|
| `delegation-detector.ts` | The text of each prompt you type | Yes |
| `drift-fuse@cc-settings` | The task prompt, edited file paths, Bash command heads and the head of the answer, for each scored turn | Yes |
| `fast-jev-compaction@fast-jev-compaction` | The conversation (messages, tool calls and results) when a session compacts | No: upstream code |

To opt a project in, add this to its `.claude/settings.json` (or `.claude/settings.local.json`, which is not committed):

```json
{ "env": { "CC_TYPESAFE_PROJECT": "1" } }
```

Claude Code applies a project's `env` block to hook processes and exposes the merged settings to plugins, so one line covers both gated senders. The value must be exactly `1`. Setting the same variable in `~/.claude/settings.json` or the shell opts every project in. A project that has not opted in behaves as if no key were set: `delegation-detector` scores with its regex, and `drift-fuse` scores nothing.

`fast-jev-compaction` is upstream code that reads the key itself, so the variable cannot gate it. To keep a client project off it, turn the plugin off for that project in its `.claude/settings.json`:

```json
{ "enabledPlugins": { "fast-jev-compaction@fast-jev-compaction": false } }
```

Compaction then falls back to Claude Code's native summary there. The installer prints the same list before it asks for a key.

### Verbatim compaction with Jev

Jev is TypeSafe's first System One model. It does not write text; it answers typed questions with calibrated probabilities, so code can consume the answer directly. Input costs $0.042 per million tokens and output is free, so one compaction of a long session costs well under a cent.

How the compaction works: when Claude Code compacts, the plugin rebuilds the conversation with every tool result replaced by a one-line note ("ok, 4213 chars"), keeps user and assistant text intact, and sends that state to Jev with two questions per tool call outside the pinned newest messages: should this call stay, and should its full output stay. Calls and results scoring below the threshold are removed or truncated to their first 300 characters; everything else stays byte for byte. Requests are batched to fit a token budget and run concurrently.

What it buys: native compaction is a summary, and summaries lose file paths, error text, constraints, and the exact wording of a decision. Verbatim compaction removes only stale tool noise, so a long session keeps its facts and the 200K working ceiling holds without a rewrite of what you and the model said.

Limits: the scoring is probabilistic, only tool calls and results are ever removed, the function-hooks surface is early access, and the plugin falls back to native compaction without a key, on a Jev error, or when it finds too little to prune.

Change either plugin's options with `/plugin configure`, `claude plugin install <plugin>@<marketplace> --config key=value` (add `--marketplace <source>` to have it offer to add a marketplace that is not registered yet, v2.1.275), or by editing `pluginConfigs` in `config/10-core.json` (rerun `bash setup.sh` to apply).

This surface may change between Claude Code releases without notice — regenerate the shared `plugins/types/claude-code.d.ts` with `/plugin-types` (`claude -p '/plugin-types <dir>'` works headless), run `bun run typecheck:plugins` and `claude plugin validate plugins/<name>`, and re-audit both hook modules after a Claude Code upgrade that touches the surface. The upstream source of the four built-in mods (`agents-md`, `diff`, `telemetry`, `sec-default`) lives at [anthropics/claude-code/mods](https://github.com/anthropics/claude-code/tree/main/mods) and is the reference for hook ordering and the testing kit.

---

## Hook Events (32 total)

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
| `TeammateIdle` | An Agent Teams teammate goes idle (not its own subagents or forks) | -- | No |
| `TaskCompleted` | A task is marked completed | -- | No |
| `TaskCreated` | A task is created via `TaskCreate` | -- | No |

### Environment Events

| Event | When | Matcher Values | Blocking |
|-------|------|----------------|----------|
| `CwdChanged` | Working directory changes during session | -- | No |
| `FileChanged` | A watched file changes on disk | -- | No |
| `DirectoryAdded` | `/add-dir` or the SDK's `register_repo_root` adds a working dir mid-session (v2.1.219) | -- | No |

### Context Management

| Event | When | Matcher Values | Blocking |
|-------|------|----------------|----------|
| `PreCompact` | Before context compaction | `manual` or `auto` | Yes |
| `PostCompact` | After context compaction completes | `manual` or `auto` | No |
| `PreModelSwitch` | Before a requested model switch is applied (v2.1.251). Input carries `from_model` and `to_model` (canonical names). Output `hookSpecificOutput.decision` is `allow`, `deny`, or `ask`; exit 2 also blocks. Default timeout 30s, and a timeout **blocks** the switch | canonical `to_model` (exact or regex, e.g. `claude-fable-5-1`, `.*fable.*`) | Yes |
| `PostModelSwitch` | After the session model changed, including switches Claude Code makes itself (restoring the model on resume) (v2.1.251). Display-only: `systemMessage` and `terminalSequence` fire, decisions are ignored | canonical `to_model` | No (always async) |
| `InstructionsLoaded` | CLAUDE.md or `.claude/rules/*.md` loaded; since v2.1.288 a load triggered by a subagent's file access carries `agent_id`, `agent_type` and `effort` | -- | No |
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
| `PreToolUse` | stdin (JSON) | Full hook context: `tool_name`, `tool_input`, `session_id`, `cwd` |
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

### Tool Input

Claude Code delivers tool input to `PreToolUse` and `PostToolUse` hooks only as JSON on stdin. It sets no `TOOL_INPUT` or `TOOL_INPUT_<key>` environment variables. The tool's parameters sit under `tool_input`:

```json
{
  "tool_name": "Bash",
  "tool_input": { "command": "git push --force origin main" },
  "session_id": "…",
  "cwd": "…"
}
```

| Field | Tools | Description |
|-------|-------|-------------|
| `tool_input.command` | `Bash` | The shell command being executed |
| `tool_input.file_path` | `Edit`, `Write` | The file path being written or edited |

Hooks in this repo read it through `readToolInput()` in `src/lib/hook-runtime.ts`. Only our Codex shim (`src/scripts/codex-hook.ts`) sets `TOOL_INPUT` (the `tool_input` object as JSON) and `TOOL_INPUT_<key>` (one per scalar key) in the hook's environment, and it forwards the same JSON on stdin too. `readToolInput()` uses those variables only when stdin is empty or not a JSON object.

**Example usage in a hook script:**

```bash
#!/usr/bin/env bash
# Read the file path from the stdin JSON
FILE_PATH="$(jq -r '.tool_input.file_path // empty')"
[[ -z "$FILE_PATH" ]] && exit 0

echo "Edited file: $FILE_PATH"
```

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
| `hooks` | list | (required) | Array of hook actions to execute |
| `if` (on each hook action) | string | -- | Conditional filter using permission rule syntax (e.g., `"Bash(git commit*)"`, `"Bash(bun add*) Bash(npm install*)"`). Lives on the action object next to `command`, not on the group: Claude Code ignores a group-level `if`, and `claude plugin` commands strip it when they rewrite settings.json |

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
| `onFailure` | string | -- | (v2.1.295, `command` and `http` types) `"block"` blocks the action when the hook cannot start, times out, or exits with an unexpected code. Unset, such a failure lets the action through. The `dispatch.ts PreToolUse` entry for the Bash matcher sets it; the Edit and Write entry does not, so a failed dispatcher cannot block an edit. |
| `continueOnBlock` | boolean | `false` | (v2.1.139, `PostToolUse` only) When the hook returns a block signal, the turn continues — the block surfaces in context but doesn't abort. Use for soft warnings. |
| `terminalSequence` | string | -- | (v2.1.141, hook output) Raw terminal escape sequence the hook returns in its JSON output. Lets hooks emit desktop notifications, set window titles, or ring the bell without owning a controlling terminal. |

### Hook Types

| Type | Description | Use For |
|------|-------------|---------|
| `command` | Executes a shell command. Exit code 0 = pass, non-zero = block (for PreToolUse). stdout is injected into Claude's context. | Validation, logging, context injection |
| `prompt` | Sends a single-turn prompt to Claude for yes/no evaluation. | Complex validation requiring LLM judgment |
| `agent` | Spawns a subagent with tool access (Read, Grep, Glob) for verification. | Multi-step validation requiring code inspection |
| `http` | Sends a webhook to a URL. Configure with `url`, `headers`, `allowedEnvVars`. Controlled by `allowedHttpHookUrls` setting. | Remote validation, external integrations, audit logging |
| `mcp_tool` | Calls a tool on a configured MCP server instead of running locally (v2.1.118). | Validation or context injection that needs an MCP server's own state |

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
| `Agent` | Any subagent spawn via the Agent tool |

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

Since v2.1.251 a `resume` SessionStart also receives the session's staleness and the estimated re-cache cost, so a hook can warn before a cold resume re-pays a large prefix. The upstream hooks reference does not yet document the field names; read them from the JSON stdin payload (`jq .` in a scratch hook) before depending on them.

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

> `updatedInput` returned by a `PreToolUse` or `PermissionRequest` hook is
> validated like Claude's own tool input (v2.1.300), so a rewrite that breaks
> the tool's schema is rejected. No cc-settings hook returns it.

> **Probe-verified (Claude Code 2.1.220, headless marker probe, replicated
> twice):** on tool events, plain stdout is NEVER injected into the model's
> context — sync or async. The ONLY delivery mechanism is the
> `{"hookSpecificOutput":{"hookEventName":…,"additionalContext":…}}` envelope
> on stdout, and it works in BOTH sync and async modes. Measured matrix:
>
> | Event | Mode | Plain stdout | Envelope stdout |
> |---|---|---|---|
> | `PreToolUse` | sync | silent | injects |
> | `PostToolUse` | sync | silent | injects |
> | `PostToolUse` | async | silent | injects |
>
> `<system-reminder>` tags inside hook output are escaped before they reach
> the model (v2.1.292), so a hook cannot pass its text off as a system
> reminder.
>
> This is event-specific, not a blanket rule: `SessionStart` plain stdout DOES
> reach the model (observed continuously across sessions). Never assume a new
> event behaves like the ones above without checking — plain stdout on
> `PostCompact` is a third, different case (folded into a user-only
> `userDisplayMessage`; see the callout below).
>
> **Rule of thumb:** any advisory hook that fires on a tool event and wants
> the model to see its output MUST use `emitAdditionalContext`
> (`src/lib/hook-runtime.ts`), not `console.log`. `async: true` is a
> scheduling choice (does Claude wait for the hook to finish?) — it is NOT a
> delivery choice (does the model see the output?).
>
> Probed and verified: PreToolUse and PostToolUse only. On PostToolUseFailure
> the envelope is UNPROBED — we use it there because plain stdout is provably
> dead on the sibling events, so the envelope is the only mechanism with any
> evidence of delivery, but it may still be discarded if the event's schema
> doesn't accept `additionalContext`. Do not cite that event as verified; probe
> before depending on delivery.

### Synchronous (default)

- Hook runs and Claude **waits** for completion before proceeding.
- Non-zero exit code from `PreToolUse` hooks **blocks** the tool execution.
- Use for: validation, blocking checks, and (via the envelope) context injection.

### Asynchronous (`async: true`)

- Hook runs in the background. Claude **does not wait**.
- Cannot block operations.
- Context injection via the envelope still works (see probe matrix above) —
  async only affects whether Claude blocks on the hook finishing, not whether
  the model eventually sees `additionalContext`.
- Use for: logging, metrics, notifications, cleanup, and non-blocking context
  injection.

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

### Dispatcher (`hooks/dispatch.ts`)

Three events run their synchronous hooks through one process each: `dispatch.ts <Event>` for `UserPromptSubmit`, `PreToolUse` and `PostToolUse`. A Bash call starts one PreToolUse process instead of two, an Edit call one PreToolUse and one PostToolUse process instead of five, and a prompt one process instead of three. The entry matchers together cover exactly the tools some handler covers, so tools no handler covers (Read, Grep, Glob) still start nothing.

The dispatcher reads stdin once, runs the handlers whose own matcher matches `tool_name` in the order below, and prints one response:

| Event | Entry matcher | Entry timeout | Handlers, in order (each handler's own matcher) |
|-------|---------------|---------------|--------------------------------------------------|
| `UserPromptSubmit` | none | 3 s | `delegation-detector`, `quota-steer`, `escalate-model` |
| `PreToolUse` | `Bash`, `Edit\|Write` and `Agent\|Task`, three entries with the same command so a Bash, Edit or Agent call each start one process | 5 s each; `onFailure: "block"` on the Bash entry only | `safety-net` (Bash), `freeze-guard` (Edit\|Write), `test-protect` (Bash\|Edit\|Write), `spawn-cap` (Agent\|Task), `visual-proof` (Bash), `pre-edit-validate` (Edit), `knowledge-hint` (Bash\|Edit\|Write) |
| `PostToolUse` | `Write\|Edit\|Bash\|Agent` | none (the default) | `post-edit` (Write\|Edit), `tool-cadence` (Bash\|Agent), `promote-memory` (Write\|Edit), `escalate-acted` (Agent) |

- **Block.** The first handler that blocks wins. The response is exactly what that handler prints when it runs alone: `{"decision":"block","reason":…}` on stdout and exit 2. The reason carries the handler's prefix (`[Safety Net]`, `[Harness]`, `[Freeze]`, `[Visual Proof]`), so it names the handler. Handlers after the blocker still run, except after `safety-net`: its block is answered at once so a slow advisory handler cannot delay it. The `additionalContext` of the other handlers is dropped when the call is blocked.
- **Ask.** When no handler blocks and at least one calls `io.ask`, the response is one `hookSpecificOutput` envelope with `"permissionDecision":"ask"` and `permissionDecisionReason` set to the asking handlers' reasons joined with newlines; the other handlers' `additionalContext` rides in the same envelope. Exit 0. Claude Code then shows the user a permission prompt with that reason. A block still wins over an ask. `test-protect` and `spawn-cap` are the handlers that ask. The envelope follows the PreToolUse decision control in the [hooks docs](https://code.claude.com/docs/en/hooks), which list `ask` among the `permissionDecision` values.
- **Context.** Every handler's `additionalContext` is joined with newlines into one `hookSpecificOutput` envelope, exit 0. Tool events inject only through that envelope (see Sync vs Async Behavior).
- **Failure.** `safety-net` is fail-closed: if it throws, times out or fails to load, the dispatcher blocks with `[Safety Net] internal error, failing closed: <detail>`, as a crashed safety-net process does when run alone. Any other handler that throws or times out is skipped, its error goes to stderr, and the rest still run. Unparseable stdin matches no tool, so nothing runs and the exit is 0.
- **Time.** `safety-net` runs first and gets the whole entry timeout. Each other handler gets the timeout its own entry had (3 s or 5 s), capped by what is left of the entry timeout minus 400 ms, and a handler that overruns is abandoned. Handlers run one after another, so a slow handler shortens the time the later ones get: a 2 s Jev call in `delegation-detector` leaves about 0.6 s for the two handlers after it. `knowledge-hint` runs `git` synchronously (2 s cap per call), which no timeout can interrupt.
- **Still separate entries.** `post-edit-tsc`, `log-bash` and `codex-verify` are `async: true`. `check-docs-before-install` is gated by an `if` filter, and the dispatcher cannot evaluate that filter, so it runs only on install commands as its own process. `verify-hooks` must run before dependency-backed code loads, and `session-start` is a plain-stdout script with top-level side effects, so both stay as SessionStart entries.

Every handler still runs as its own script (`bun src/hooks/<name>.ts < payload.json`), which is how the tests, `bun run hooks:bench` and the Codex plugin invoke them. A handler exports `main(io: HookIO)` (`src/lib/hook-runtime.ts`) and calls `io.hookInput`, `io.toolInput`, `io.context`, `io.ask` and `io.block` instead of printing and exiting; run alone it gets `processIO`, run by the dispatcher it gets a `captureIO` over the payload the dispatcher read.

### SessionStart

| Script | Purpose | Async |
|--------|---------|-------|
| `verify-hooks.ts` | Validates the hooks-block fingerprint on session start; warns on tampering | No |
| `session-start.ts` | Surfaces auto-memory pointer, auto-warms TLDR index | No |
| `codex-verify.ts` | Cheap Codex CLI availability check (`codex login status`) for the statusline badge; persists the verdict to `~/.claude/tmp/codex-verdict.json`. Silent on success and error, fail-open | Yes |

### UserPromptSubmit

| Script | Purpose | Async |
|--------|---------|-------|
| `delegation-detector.ts` | Flags prompts that look like multi-file work before the model plans. With `TYPESAFE_API_KEY` set (settings `env` block or shell) and the project opted in with `CC_TYPESAFE_PROJECT=1`, it sends the prompt to TypeSafe's Jev model with one statement ("this would touch 3+ files, need 12+ tool calls, or run several workstreams") and fires when the probability is ≥ 0.7; the prompt text leaves the machine for that call (2 s timeout, p50 ~320 ms measured, ~$0.00002 per prompt). Without a key, without the opt-in, or on any failure or timeout, the pre-15.23.0 regex score decides (breadth phrases, path-shaped tokens, list items; fires at ≥ 2). Either way it injects `additionalContext` naming the signal and deferring to the delegation rule in CLAUDE.md. Measured on 1,102 real prompts: regex 21 fires / 10 correct; Jev at 0.7 83 fires / 53 correct. | No |
| `quota-steer.ts` | Reads the statusline's cached rate-limit percentages; injects quota-aware model-routing guidance (Codex bridge / Sonnet downshift) once usage crosses elevated/critical/exhausted thresholds; at exhausted (≥95%) it re-injects every prompt and directs a full funnel to Codex plus a user-facing notice. Fail-open | No |
| `escalate-model.ts` | Suggests escalating to a Fable-model subagent when the same problem signature repeats `CC_ESCALATE_THRESHOLD`+ times. Quota-gated, fail-open | No |

> Note: Since v2.1.299, `UserPromptSubmit` hooks run before a skill or custom slash command expands, so a hook that blocks the prompt also stops the command's embedded shell lines. A skill's own front-matter `UserPromptSubmit` hook first runs on the prompt after the one that invokes the skill.

> Note: Since v2.1.108 Claude Code has a native `Skill` tool that auto-matches skills; the old `skill-activation` hook was removed. Correction detection was removed as low-signal.

### PreModelSwitch (matcher: `.*fable.*|.*mythos.*`)

| Script | Purpose | Async |
|--------|---------|-------|
| `model-switch-guard.ts` | Reads the same cached rate-limit percentages as `quota-steer.ts` at the moment of a switch to a fable/mythos model. At ≥95% (5h or weekly) it asks for confirmation, naming the percentage — Fable draws the weekly pool at ~2x the Opus rate and is capped at 50% of it. At the critical band below that it allows the switch and annotates it with a scoping reminder. Below critical it stays silent. Never denies the switch. Fail-open | No |

### PreToolUse (Bash matcher)

| Script | Purpose | Async |
|--------|---------|-------|
| `safety-net.ts` | Blocks destructive shell commands (rm -rf /, force push, etc.), content reads of secret files (`~/.ssh`, `~/.aws`, `.env`, ...), git hook skips (`--no-verify`, `HUSKY=0`, `-c core.hooksPath`), and `gh` writes outside `darkroomengineering` and the user's own account. An unexpected internal error exits 1 and blocks when it runs alone; the dispatcher blocks with the same reason | No |
| `visual-proof.ts` | Blocks (reason prefixed `[Visual Proof]`, exit 2) `gh pr create`, and `gh pr edit` with `--body`/`-b` or `--body-file`/`-F`, when the branch changes a design file (`.css`, `.scss`, `.sass`, `.less`, `.html`, `.vue`, `.svelte`, `.astro`, `.tsx`, `.jsx`) and the body has no proof. Proof is a markdown image or `<img>` tag hosted anywhere but `raw.githubusercontent.com` (those URLs 404 until the branch is merged), or the "Screenshots: before/after needed" line from `rules/git.md`, in any case, bold or list item. Changed files come from `git diff --name-only <base>...HEAD` in the payload `cwd` (or the directory a literal `cd` earlier in the command moved to); `--base X`/`-B X` is tried as `origin/X`, then `X`, and without it the base is `origin/HEAD`, then `origin/main`. The body is checked before git runs, and git gets 1 s per call. Not checked: bodies from `--fill`, `--fill-first`, `--web`, the editor, stdin (`-F -`), variables or `$(...)`; a `--body-file` it cannot read; `--head` (the diff always ends at the local `HEAD`, so `gh pr edit <number>` from another branch compares the wrong range). A `.tsx`/`.jsx` change that only touches tests or logic still counts as a design change. Blocks rather than asks, since the agent fixes it by editing the body. Fail-open on any error or git failure | No |
| `check-docs-before-install.ts` | Reminds to fetch docs before installing new packages | No |

### PreToolUse (Edit matcher)

| Script | Purpose | Async |
|--------|---------|-------|
| `pre-edit-validate.ts` | Validates edit strategy (file recently read, edit size appropriate) | No |

### PreToolUse (Edit|Write matcher)

| Script | Purpose | Async |
|--------|---------|-------|
| `freeze-guard.ts` | When the current session's `/freeze` boundary is active, blocks Edit/Write calls targeting any file outside the locked directory. Session records are independent; legacy untagged state remains a fallback | No |

### PreToolUse (Bash|Edit|Write matcher)

| Script | Purpose | Async |
|--------|---------|-------|
| `test-protect.ts` | Asks for approval (`permissionDecision: "ask"`, reason prefixed `[Test Guard]`) before a call disables or deletes a test: an Edit that adds a skip marker (`.skip(`, `.only(`, `.todo(`, `xit(`, `xdescribe(`, `xtest(`, `describe.skip`, `it.skip`, `test.skip`, `@Disabled`, `t.Skip(`, `@pytest.mark.skip`, `pytest.skip(`) to a test file, a Write that leaves an existing test file with more of them, `rm`/`unlink`/`git rm` of a test file or test directory, `find … -delete` or `-exec rm` over a test directory or test-name filter, or `mv`/`git mv` of one to a name no runner picks up (`.bak`, `.disabled`, dropped `.test.`, out of a test directory or out of the project). It does not see an edit that deletes assertions without adding a marker, nor deletes through `xargs`, `cd … &&`, or paths built from variables. A test file is `*.test.*`, `*.spec.*`, `*_test.go`, `*_test.py`, `test_*.py`, or anything under `__tests__/`, `tests/`, `test/` or `e2e/`. Asks rather than blocks, since deleting the tests of removed code is legitimate. A Write that creates a new test file passes silently. Fail-open | No |
| `knowledge-hint.ts` | Surfaces up to 3 team-knowledge notes whose slug/tags match the Bash command or edited file, once per note per session; reads the 6h index cache, never the network | No |

### PreToolUse (Agent|Task matcher)

| Script | Purpose | Async |
|--------|---------|-------|
| `spawn-cap.ts` | Counts the Agent tool calls of each session and asks for approval (`permissionDecision: "ask"`, reason prefixed `[Spawn Cap]`) at the 30th, then every 15th after it (45, 60, …). Never blocks, since Workflows and ultracode legitimately start dozens of agents. Agents started by a Workflow script do not go through the Agent tool, so they are not counted. Each call appends one token line to `~/.claude/tmp/spawn-count-<sha256 of session id>.log` and takes its token's position as its count, so Agent calls sent in parallel each get a distinct count; a session's first spawn deletes such files older than 7 days. A payload without a session id is not counted. Fail-open | No |

### PostToolUse (Write|Edit matcher)

| Script | Purpose | Async |
|--------|---------|-------|
| `post-edit.ts` | Auto-formats edited files with Biome | No |
| `post-edit-tsc.ts` | Runs TypeScript type check on edited files | Yes |
| `promote-memory.ts` | Nudges (once per file) when a team-relevant auto-memory file is written under `.../memory/`, for `project`/`feedback` memory types | No |

### PostToolUse (Agent matcher)

| Script | Purpose | Async |
|--------|---------|-------|
| `escalate-acted.ts` | Records that a model-escalation suggestion was acted on — the "acted" half of the `escalate-model.ts`/`delegation-detector.ts` fired-vs-acted telemetry pair | No |

### PostToolUse (Bash matcher — command logging)

| Script | Purpose | Async |
|--------|---------|-------|
| `log-bash.ts` | Logs every Bash command to `~/.claude/logs/bash-YYYY-MM-DD.log` | Yes |

Logs are used by `bun run claude-audit` to analyze command patterns, security concerns, and repeated commands. Hook receives JSON on stdin with `tool_input.command`.

Before writing, the logger redacts recognized credentials, including secret-like
assignments with quoted, escaped, or mixed quoted/unquoted values. Redaction is
best effort; it does not guarantee arbitrary command text is free of secrets.

**Log format:** `[HH:MM:SS] [project] command`

**Retention:** Controlled by `CLAUDE_LOG_RETENTION_DAYS` env var (default: 1 day, today only). Old logs are pruned automatically on each hook fire.

### PostToolUse (Bash or Agent)

| Script | Purpose | Async |
|--------|---------|-------|
| `tool-cadence.ts` | Tracks reviewable Agent spawns since the last successful commit or push, reconciles when HEAD changes, and nudges at `CC_MAX_UNREVIEWED`. State lives at `~/.claude/tmp/review-queue.json`. Delegation thresholds are instructions in CLAUDE-FULL.md. | No |

### PostToolBatch

| Script | Purpose | Async |
|--------|---------|-------|
| `ledger-record.ts` | Appends the file paths a batch read/changed to the session ledger at `~/.claude/tmp/session-ledger/<session_id>.jsonl`. Metadata only — never file contents. Silent, no stdout | **Yes** |

`PostToolBatch` fires **once per batch of parallel tool calls**, which is why the
ledger writes from here rather than from `PostToolUse`: a turn that reads six
files in parallel appends six entries from one process instead of racing six
concurrent appenders on one file. Payload, captured from a live 2.1.220 run:

```json
{
  "session_id": "…", "transcript_path": "…", "cwd": "…", "prompt_id": "…",
  "permission_mode": "…", "effort": {…}, "hook_event_name": "PostToolBatch",
  "tool_calls": [
    { "tool_name": "Read", "tool_input": {"file_path": "…"},
      "tool_use_id": "…", "tool_response": "1\talpha\n2\t" }
  ]
}
```

The array field is `tool_calls` (not `tool_uses`), and `tool_response` carries
the **full body** of every file read — the ledger deliberately never touches it.

### PostToolUseFailure

| Script | Purpose | Async |
|--------|---------|-------|
| `post-failure.ts` | Logs tool failures, keeps the per-tool and per-signature tallies that `escalate-model.ts` reads, and records the exact tool + bounded/redacted error in the session ledger. Injects nothing itself. | No |

Payload (verified against the 2.1.220 binary — the published page omits this
event's shape): `{...common, hook_event_name, tool_name, tool_input,
tool_use_id, error, is_interrupt, duration_ms}`. Note `error` is a top-level
string, not a `tool_output` wrapper.

### PreCompact

| Script | Purpose | Async |
|--------|---------|-------|
| `handoff.ts create --from-hook` | Saves task state before compaction. `--from-hook` reads the hook payload from stdin for `session_id` + `trigger`, which is what lets PostCompact find this exact handoff afterwards | No |

### PostCompact

| Script | Purpose | Async |
|--------|---------|-------|
| `post-compact.ts` | Persists the native `compact_summary` into the handoff the preceding PreCompact wrote (matched on `sessionId`) | No |

> **PostCompact stdout does NOT reach the model.** The runtime builds the payload
> as `{...common, hook_event_name:"PostCompact", trigger, compact_summary}` and
> folds each hook's stdout into a `userDisplayMessage` — user-visible only.
> Verified against the 2.1.220 binary; the published hooks page documents
> neither the `compact_summary` field nor this behaviour. Anything that needs to
> reach the model after compaction belongs in **SessionStart with
> `source: "compact"`**, whose stdout is injected.

### Stop

| Script | Purpose | Async |
|--------|---------|-------|
| `ask-gate.ts` | Blocks a turn that ends in a prose question with no `AskUserQuestion` call; tells Claude to ask through the tool | No |

> **v2.1.163:** `Stop` and `SubagentStop` hooks may return `hookSpecificOutput.additionalContext` to feed text back to Claude and keep the turn going — it surfaces as context rather than being treated as a hook error.

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
- A synchronous hook on `UserPromptSubmit`, `PreToolUse` or `PostToolUse` joins the dispatcher instead of getting its own entry: export `main(io: HookIO)`, add it to `HANDLERS` in `src/hooks/dispatch.ts` with the matcher and timeout it would have had, widen the dispatcher entry's matcher in `config/40-hooks.json` if it covers a new tool, and keep the entry timeout equal to the max of the handlers' (`tests/dispatch.test.ts` checks both). A hook that must be `async`, gated by `if`, or isolated in its own process keeps its own entry.
- Always quote `$HOME` paths in the `command` string.
- Use `async: true` for non-blocking operations (logging, metrics).
- Set reasonable `timeout` values (default 600s is often too long for simple scripts).
- For `PreToolUse` hooks: exit 0 means allow, exit 2 means block (output JSON with `{"decision":"block","reason":"..."}`). To hand the decision to the user instead, exit 0 with `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"..."}}` (`io.ask` in a dispatched handler). Include a clear message explaining why.
- Write to log files for debugging rather than relying on stdout for async hooks.

---

## Debugging Hooks

### Log Locations

| Log File | Contents |
|----------|----------|
| `~/.claude/hooks.log` | General hook execution output |
| `~/.claude/swarm.log` | Subagent start/stop and task created/completed events |
| `~/.claude/sessions.log` | Session lifecycle events |
| `~/.claude/logs/tool-failures.log` | Tool failure events (from `post-failure.ts`) |
| `~/.claude/safety-net.log` | Blocked command audit log (from `safety-net.ts`) |
| `~/.claude/logs/bash-*.log` | Daily Bash command logs (from `log-bash.ts`) |

`claude --debug` logs each command hook on tool calls, prompts, `SessionStart` and `Stop` when it finishes, with its command, plugin, outcome and duration (v2.1.296). Use it to find the slow hook in one live session; `bun run hooks:bench` measures every synchronous hook offline.

### Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Hook never fires | Wrong `matcher` value | Check tool name spelling; use `Write\|Edit` not `Write, Edit` |
| Hook fires but no effect | Script not executable | Run `chmod +x` on the script |
| Hook blocks unexpectedly | Script exits non-zero | Add error handling; check exit codes |
| Hook output not visible | Using `console.log` instead of the envelope | Plain stdout never reaches the model on tool events (sync or async — see "Sync vs Async Behavior" above); use `emitAdditionalContext` |
| Hook causes timeout | Script hangs | Add timeout to the script itself; reduce `timeout` value |
| Hook sees no tool input | Reading `$TOOL_INPUT*` env vars | Claude Code sets none; read `tool_input` from the stdin JSON (`readToolInput()` in `src/lib/hook-runtime.ts`) |
| Path not found | Missing quotes | Always quote the path: `bun "$HOME/.claude/src/scripts/..."` (or `src/hooks/...`) |

### Testing a Hook Manually

```bash
# Simulate a PreToolUse payload on stdin
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}' \
  | bun ~/.claude/src/hooks/safety-net.ts

# Check exit code
echo $?  # 0 = allow, 2 = block
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
