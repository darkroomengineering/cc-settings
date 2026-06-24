# Settings Reference

Complete reference for all settings in `settings.json` and related configuration files.

---

## Configuration File Locations

| File | Scope | Contains |
|------|-------|----------|
| `config/*.json` (project repo) | Team-shared, checked into git | Settings fragments (core, mcp, permissions, hooks) composed at install time |
| `~/.claude.json` | Per-user, machine-local | Personal MCP servers, user-specific overrides |
| `~/.claude/CLAUDE.md` | Per-user, global instructions | Behavioral instructions loaded into every session |
| `<project>/CLAUDE.md` | Per-project instructions | Project-specific behavioral instructions |

The installer (`setup.sh`) composes the repo's `config/*.json` fragments alphabetically into `~/.claude/settings.json`, making it the global default for all projects. Authoring happens in the individual fragments so PRs touching hooks don't churn permissions diffs. Preview the composed output with `bun run compose`.

### IDE IntelliSense

The composed `settings.json` declares the official Claude Code `$schema` (`https://json.schemastore.org/claude-code-settings.json`). Claude Code validates this URL strictly at startup and skips the entire file if anything else is set, so don't change it. VSCode, Cursor, JetBrains, and any editor with JSON Schema support pick up the canonical schema for autocomplete and validation.

If you author a `~/.claude/settings.json` by hand (without re-running the installer), use the same value:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  ...
}
```

cc-settings publishes its own extended schemas at `raw.githubusercontent.com/darkroomengineering/cc-settings/main/schemas/` for *non-settings* files: `agent.schema.json`, `skill.schema.json`, `claude-json.schema.json`. They're regenerated from `src/schemas/*.ts` via `bun run schemas:emit` (CI fails if you change a zod source without re-emitting — see `bun run schemas:check`).

---

## Top-Level Settings

### `env`

Environment variables injected into every Claude Code session.

```json
{
  "env": {
    "CLAUDE_CODE_EFFORT_LEVEL": "xhigh",
    "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB": "1"
  }
}
```

| Variable | Values | Description |
|----------|--------|-------------|
| `CLAUDE_CODE_EFFORT_LEVEL` | `low`, `medium`, `high`, `xhigh`, `max` | Default adaptive thinking depth. cc-settings uses `xhigh` — Anthropic's recommended setting for coding and agentic workflows on Opus 4.7/4.8. On 4.8 the model default is `high`; this env var overrides it ([model-config docs](https://code.claude.com/docs/en/model-config#choose-an-effort-level)) |
| `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` | `"1"` or unset | Strips credentials from subprocess environments. Security hardening |
| `CLAUDE_CODE_NO_FLICKER` | `"1"` or unset | Flicker-free alt-screen rendering. Pairs with `/tui fullscreen` |
| `CLAUDE_CODE_SCRIPT_CAPS` | integer (string) | Bounds per-session hook-script invocations. cc-settings sets `500` to guard against runaway hooks (v2.1.98+) |
| `ENABLE_PROMPT_CACHING_1H` | `"1"` or unset | Extends prompt cache TTL from 5 min → 1 hour. cc-settings enables this (v2.1.108+) |
| `SLASH_COMMAND_TOOL_CHAR_BUDGET` | number (string) | Override skill character budget (default: 2% of context window). Not set by default — let it auto-scale |
| `ENABLE_TOOL_SEARCH` | `auto:N` | MCP tool deferral threshold. Tools deferred when descriptions exceed N% of context. Per-server opt-out via `alwaysLoad: true` (v2.1.121) |
| `CLAUDE_CODE_DISABLE_1M_CONTEXT` | `"true"` or unset | Opt out of 1M context window (Max plan default — rarely needed) |
| `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS` | `"true"` or unset | Suppress git status in system prompt (see also `includeGitInstructions` setting) |
| `CLAUDE_CODE_DISABLE_CRON` | `"true"` or unset | Disable scheduled cron jobs |
| `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` | milliseconds (string) | Timeout for SessionEnd hooks (default: 1500ms) |
| `CLAUDE_CODE_HIDE_CWD` | `"1"` or unset | Hide the working directory in the startup logo (v2.1.119) |
| `DISABLE_UPDATES` | `"1"` or unset | Block all update paths including manual `claude update`. Stricter than `DISABLE_AUTOUPDATER` (v2.1.118) |
| `CLAUDE_CODE_FORK_SUBAGENT` | `"1"` or unset | Enable forked subagents on external builds; works in non-interactive sessions as of v2.1.121 |
| `AI_AGENT` | set automatically | Set by Claude Code for subprocesses so `gh` can attribute traffic correctly (v2.1.120) |
| `CLAUDE_EFFORT` | set automatically | Available inside skills as `${CLAUDE_EFFORT}` for effort-aware behavior (v2.1.120) |
| `OTEL_LOG_USER_PROMPTS` | `"1"` or unset | Adds `user_system_prompt` to LLM request spans (v2.1.121) |
| `ANTHROPIC_BEDROCK_SERVICE_TIER` | `default`, `flex`, `priority` | Sent as `X-Amzn-Bedrock-Service-Tier` to select a Bedrock service tier (v2.1.122) |
| `ANTHROPIC_CUSTOM_MODEL_OPTION` | model ID string | Add a custom entry to the `/model` picker |
| `CLAUDE_CODE_SESSION_ID` | set automatically | Mirrors the `session_id` passed to hooks; available inside Bash tool subprocesses (v2.1.132) |
| `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` | `"1"` or unset | Opt out of the fullscreen alternate-screen renderer and keep the conversation in the terminal's native scrollback (v2.1.132) |
| `CLAUDE_CODE_FORCE_SYNC_OUTPUT` | `"1"` or unset | Force-enable synchronized output on terminals that auto-detection misses (e.g. Emacs `eat`) (v2.1.129) |
| `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE` | `"1"` or unset | On Homebrew or WinGet installs, Claude Code runs the upgrade command in the background and prompts to restart (v2.1.129) |
| `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` | `"1"` or unset | Opt in to `/v1/models` discovery for the `/model` picker on third-party gateways (was automatic 2.1.126–2.1.128) (v2.1.129) |
| `CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL` | `"1"` or unset | Re-enable the session quality survey for enterprises capturing responses through OpenTelemetry (v2.1.136) |
| `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` | integer (string) | Caps consecutive Stop-hook block cycles before the turn ends with a warning (default: 8) (v2.1.143) |
| `CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY` | `"1"` or unset | Opt out of the new PowerShell `-ExecutionPolicy Bypass` default. Windows only (v2.1.143) |
| `CLAUDE_CODE_PLUGIN_PREFER_HTTPS` | `"1"` or unset | Clone GitHub plugin sources over HTTPS instead of SSH. For environments without a GitHub SSH key (v2.1.141) |
| `ANTHROPIC_WORKSPACE_ID` | UUID string | Scopes the workload-identity-federation minted token to a specific workspace (v2.1.141) |
| `CLAUDE_CODE_USE_POWERSHELL_TOOL` | `"0"` to opt out, unset for default | Now defaults on for Windows Bedrock/Vertex/Foundry users (v2.1.143) |
| `CLAUDE_CODE_ENABLE_AWAY_SUMMARY` | `"0"` to opt out, unset for default | On by default; produces a session recap on re-entry after background work. Set `=0` to opt out (v2.1.110) |
| `CLAUDE_CODE_ENABLE_AUTO_MODE` | `"1"` or unset | Opt in to auto mode on Bedrock, Vertex, and Foundry for Opus 4.7/4.8 (native on the first-party API) (v2.1.158) |
| `CLAUDE_CODE_SHELL_PREFIX` | shell prefix string | Custom shell prefix for MCP stdio server launches; overrides the default shell used to spawn stdio MCP processes (v2.1.128) |
| `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` | duration (ms) | Idle timeout for remote MCP tool calls; calls that go idle abort with an error instead of hanging (previously stuck for ~5 min) (v2.1.187) |
| `CLAUDE_CODE_SUBAGENT_MODEL` | model shortname (e.g., `sonnet`) | Routes Agent Teams teammate subprocess sessions to a specific model; main session model is unaffected. cc-settings sets `sonnet` (v2.1.147) |
| `CLAUDE_CODE_TMPDIR` | directory path | Overrides the temp directory used for Unix sockets and scratch files; set it shallow to avoid `EADDRINUSE` from over-long socket paths (v2.1.161) |
| `OTEL_LOG_TOOL_DETAILS` | `"1"` or unset | Include custom/MCP command names in OTEL tool spans, and `tool_parameters` in `tool_decision` events; values are redacted unless this is set (v2.1.117; `tool_decision` params added v2.1.157) |
| `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` | `"1"` or unset | Hide Anthropic's bundled skills, workflows, and built-in slash commands from the model. Env counterpart of the `disableBundledSkills` setting (v2.1.169) |
| `CLAUDE_CODE_SAFE_MODE` | `"1"` or unset | Start Claude Code with all customizations disabled (CLAUDE.md, plugins, skills, hooks, MCP servers) for troubleshooting. Env counterpart of the `--safe-mode` flag (v2.1.169) |
| `CLAUDE_CLIENT_PRESENCE_FILE` | file path | Path to a presence file Claude Code touches while active; suppresses mobile push notifications when the desktop client is present (v2.1.181) |
| `API_FORCE_IDLE_TIMEOUT` | `"0"` to opt out, unset for default | Restores a default 5-minute idle timeout on Vertex/Foundry so a stalled stream aborts instead of hanging; set `=0` to opt out (v2.1.169) |
| `CLAUDE_CODE_MAX_RETRIES` | integer (string) | Max API retry attempts on transient failures; capped at `15` as of v2.1.186. For unattended sessions prefer `CLAUDE_CODE_RETRY_WATCHDOG` |
| `CLAUDE_CODE_RETRY_WATCHDOG` | `"1"` or unset | Keeps retrying transient API failures past the `CLAUDE_CODE_MAX_RETRIES` cap for long unattended sessions (v2.1.186) |

> **Note on `ultracode` mode (v2.1.154+)**: `/effort ultracode` is a Claude Code session-only mode that sends `xhigh` to the model AND has Claude plan a [dynamic workflow](https://code.claude.com/docs/en/workflows) for each substantive task. It is **not** a valid value for `CLAUDE_CODE_EFFORT_LEVEL`, the `effortLevel` setting, or the `--effort` flag — set it via `/effort ultracode` in-session, or pass `"ultracode": true` through `--settings` or an Agent SDK control request. Disable workflows entirely with `CLAUDE_CODE_DISABLE_WORKFLOWS=1` or `"disableWorkflows": true`.

### `model`

Default model for all sessions.

```json
{
  "model": "opus"
}
```

| Value | Model | Notes |
|-------|-------|-------|
| `fable` | Claude Fable 5 | **⚠ SUSPENDED 2026-06-12** (export-control directive; disabled for all customers, no restoration date — [details](https://www.anthropic.com/news/fable-mythos-access)). Still a valid alias for when access returns. Top tier, above Opus — agentic/SWE-tuned. 1M context (native; no `[1m]` pin needed). ~2× Opus token cost ($10/$50 per Mtok). First-party API / claude.ai Max. |
| `opus` / `opus[1m]` | Claude Opus 4.8 | **cc-settings default (interim, while Fable is suspended): `opus[1m]`.** `opus` resolves to Claude Opus 4.8 on Anthropic API / claude.ai Max. Full capability, adaptive thinking. Not 1M-native — use the `[1m]` pin to force the 1M window. Requires Claude Code v2.1.154+ |
| `sonnet` | Claude Sonnet 4.6 | Faster, lower cost. 1M context on Max |
| `haiku` | Claude Haiku 4.5 | Fastest, lowest cost |

> **Provider notes**: On Claude Platform on AWS, `opus` resolves to Opus 4.7. On Bedrock, Vertex, and Foundry, `opus` resolves to Opus 4.6 — pin `claude-opus-4-8` explicitly via `ANTHROPIC_DEFAULT_OPUS_MODEL` to get the latest model on those providers.

### `teammateMode`

Controls Agent Teams behavior when enabled.

```json
{
  "teammateMode": "auto"
}
```

| Value | Behavior |
|-------|----------|
| `auto` | Teammates self-coordinate via shared task list |
| `in-process` | Teammates run inside the main process |
| `tmux` | Each teammate gets a tmux pane |
| `iterm2` | Each teammate gets an iTerm2 split (2.1.186; warns if the `it2` CLI is missing) |
| `manual` | Teammates require explicit direction |
| `disabled` | Agent Teams off |

### `attribution`

Controls AI attribution in git commits and PRs. Replaces the deprecated `coauthorship` setting.

```json
{
  "attribution": {
    "commit": "",
    "pr": "",
    "sessionUrl": false
  }
}
```

Empty strings suppress the `commit`/`pr` attribution text. `sessionUrl` (boolean, added 2.1.183) controls the claude.ai session link appended to commits and PRs — empty strings do **not** suppress it, so `false` is required to omit it. Darkroom policy: **no AI attribution** — all three off.

### `statusLine`

Custom status bar displayed in the Claude Code terminal.

```json
{
  "statusLine": {
    "type": "command",
    "command": "bun \"$HOME/.claude/src/hooks/statusline.ts\""
  }
}
```

The `statusline.ts` script displays model name, git branch, and context usage percentage.

### `plansDirectory`

Directory where Claude Code writes plan output files (from planner agent, PRD skill, etc.).

```json
{
  "plansDirectory": "./plans"
}
```

| Value | Behavior |
|-------|----------|
| `"./plans"` | Relative to project root. Plans saved to `<project>/plans/` |
| Any path string | Absolute or relative path for plan output |

### `includeGitInstructions`

Controls whether Claude Code injects its built-in git workflow instructions into the system prompt. Since AGENTS.md and rules/git.md already provide comprehensive git guidance, this is disabled to save ~2K tokens of context.

```json
{
  "includeGitInstructions": false
}
```

### `sandbox`

Sandbox configuration for secure command execution. cc-settings ships with `failIfUnavailable: false` — opt-in per machine once you've confirmed sandbox support (bubblewrap on Linux, native on macOS).

```json
{
  "sandbox": {
    "failIfUnavailable": false
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `failIfUnavailable` | boolean | Exit with error when sandbox is enabled but unavailable (default: false) |
| `enableWeakerNetworkIsolation` | boolean | macOS: weaker network isolation for MITM proxy verification |
| `filesystem.allowRead` / `allowWrite` | list | Re-allow paths inside `denyRead`/`denyWrite` regions (v2.1.77, v2.1.78) |
| `network.deniedDomains` | list | Block specific domains despite broader `allowedDomains` wildcard (v2.1.113) |
| `credentials.files` | list | Deny sandboxed reads of credential files: `[{ "path": "~/.aws/credentials", "mode": "deny" }]` (v2.1.187) |
| `credentials.envVars` | list | Unset secret env vars before each sandboxed command: `[{ "name": "GITHUB_TOKEN", "mode": "deny" }]` (v2.1.187) |
| `bwrapPath` | string | Linux/WSL: managed override for the bubblewrap binary location (v2.1.133) |
| `socatPath` | string | Linux/WSL: managed override for the socat binary location (v2.1.133) |

`credentials` is the dedicated block for keeping secrets out of sandboxed Bash commands — file paths are denied for reads (same enforcement as `filesystem.denyRead`) and env vars are unset per-command. `"deny"` is the only supported `mode`. There is no built-in deny list, so only listed entries are restricted, and entries merge across settings scopes (any scope can add restrictions, none can remove them). For a process-wide scrub of Anthropic/cloud credentials regardless of sandboxing, use `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` instead.

### `spinnerVerbs`

Customizes the animated spinner text shown while Claude is processing.

```json
{
  "spinnerVerbs": {
    "mode": "replace",
    "verbs": ["Analyzing", "Architecting", "Building", "Crafting", "Debugging", "..."]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `mode` | `"replace"` or `"append"` | `replace` overrides default verbs entirely; `append` adds to them |
| `verbs` | list of strings | Present-participle verbs shown in the spinner (e.g., "Analyzing", "Building") |

### `spinnerTipsOverride`

Suppress the time-based tips that appear under the spinner (v2.1.122).

```json
{
  "spinnerTipsOverride": {
    "excludeDefault": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `excludeDefault` | boolean | When `true`, skips Claude Code's built-in tip rotation. Useful for cleaner CI output or recordings |

### `modelOverrides`

Maps model picker entries to custom provider model IDs (e.g., Bedrock ARNs, Vertex endpoints).

```json
{
  "modelOverrides": {
    "opus": "arn:aws:bedrock:us-west-2:...:foundation-model/anthropic.claude-opus-4-8",
    "sonnet": "arn:aws:bedrock:us-west-2:...:foundation-model/anthropic.claude-sonnet-4-6"
  }
}
```

### `autoMemoryDirectory`

Custom directory for auto-memory storage.

```json
{
  "autoMemoryDirectory": "./memory"
}
```

### `worktree`

Configuration for git worktree operations.

```json
{
  "worktree": {
    "baseRef": "fresh",
    "sparsePaths": ["src/", "packages/shared/"]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `baseRef` | `"fresh"` \| `"head"` | What `--worktree`, `EnterWorktree`, and agent-isolation worktrees branch from. `fresh` (default since v2.1.133) → `origin/<default-branch>`. `head` → local `HEAD` (the 2.1.128–2.1.132 default). Use `head` to keep unpushed commits in new worktrees |
| `bgIsolation` | `"none"` | Lets background sessions edit the working copy directly without `EnterWorktree`. For repos where worktrees are impractical (v2.1.143) |
| `sparsePaths` | list | Directories to check out in each worktree via git sparse-checkout. Useful for large monorepos |

### `skillOverrides`

Hide or trim individual skills from the model and the `/` slash-command picker (v2.1.129 — fully functional in 2.1.129+; earlier versions silently no-op'd).

```json
{
  "skillOverrides": {
    "noisy-skill": "off",
    "experimental-skill": "user-invocable-only",
    "verbose-skill": "name-only"
  }
}
```

| Value | Effect |
|-------|--------|
| `"off"` | Hide entirely — invisible to the model and to `/` |
| `"user-invocable-only"` | Hide from the model; user can still invoke via `/` |
| `"name-only"` | Visible to the model but with the description collapsed to just the name |

### `parentSettingsBehavior`

Admin-tier key (v2.1.133). Controls whether the SDK's `managedSettings` (the "parent" tier) participates in the standard policy merge.

```json
{
  "parentSettingsBehavior": "merge"
}
```

| Value | Effect |
|-------|--------|
| `"first-wins"` | Default — managed settings take precedence and shadow downstream tiers |
| `"merge"` | Opt managed settings into the standard merge logic alongside team/user tiers |

### `prUrlTemplate`

Point the footer PR badge at a custom code-review URL instead of github.com (v2.1.119).

```json
{
  "prUrlTemplate": "https://reviews.your-host.example/{owner}/{repo}/pull/{number}"
}
```

Substitutes `{host}`, `{owner}`, `{repo}`, `{number}`, and `{url}` from the `gh`-reported PR URL.

### `showThinkingSummaries`

Show inline thinking summaries (the model's pre-action reasoning) in the conversation. cc-settings ships `true`. Set `false` to hide.

```json
{ "showThinkingSummaries": true }
```

### `autoScrollEnabled`

Auto-scroll to the bottom of the conversation as new output streams in (v2.1.102). Disable to keep the viewport pinned to wherever the user scrolled.

```json
{ "autoScrollEnabled": false }
```

### `respondToBashCommands`

Whether `!`-prefixed bash command output automatically triggers a Claude response (v2.1.186). Defaults to `true` — Claude reacts to the output as if you'd asked about it. Set `false` to restore the prior behavior, where the output is inserted silently and Claude waits for your next prompt.

```json
{ "respondToBashCommands": false }
```

### `changelogUrl`

Override the URL `/release-notes` fetches the changelog from. Useful for enterprise mirrors or third-party gateway deployments.

```json
{ "changelogUrl": "https://internal.example.com/claude-code/CHANGELOG.md" }
```

### `disableAllHooks`

Master kill-switch for the entire hooks subsystem. When `true`, no hook of any event type fires. Useful for debugging or running Claude Code in a stripped-down environment.

```json
{ "disableAllHooks": true }
```

**Caveat:** Disabling hooks wholesale also silences `/goal` (which is implemented as a Stop hook) and the cc-settings `tool-cadence` / `delegation-detector` delegation guardrails. If `verify-hooks` warns you about suspicious hooks, remove the suspicious entries surgically rather than flipping this kill switch — see SECURITY.md "Don't disable hooks wholesale" for the full guidance.

### `disableAutoMode`

Disable auto-mode entirely (admin-tier). Once set, `/auto` and the auto-mode permission flow are unavailable in this profile.

```json
{ "disableAutoMode": "disable" }
```

### `disableBypassPermissionsMode`

Disable the `bypassPermissions` mode (admin-tier). With this set, `--permission-mode bypassPermissions` and the in-session shortcut are rejected — a hard guardrail for managed deployments.

```json
{ "disableBypassPermissionsMode": "disable" }
```

### `skipDangerousModePermissionPrompt`

Skip the confirmation prompt shown before entering bypass-permissions mode (via `--dangerously-skip-permissions` or `defaultMode: "bypassPermissions"`). **Ignored when set in project settings** (`.claude/settings.json`) so an untrusted repo can't auto-bypass the prompt.

```json
{ "skipDangerousModePermissionPrompt": true }
```

### `effortLevel`

Persist the effort level across sessions — the `settings.json` counterpart of the `CLAUDE_CODE_EFFORT_LEVEL` env var (cc-settings pins `xhigh` via the env var). Values: `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`. The official docs for this key list only the first four, but the env var and real live configs also persist `"max"` — our schema accepts it as a superset so a live `settings.json` validates.

```json
{ "effortLevel": "xhigh" }
```

### `disableSkillShellExecution`

Disable the Skill tool's ability to run inline shell commands (v2.1.98). Skills can still load text and prompt the model, but `bun ~/.claude/...` invocations from within a skill are blocked.

```json
{ "disableSkillShellExecution": true }
```

### `disableBundledSkills`

Hide Anthropic's *bundled* skills, workflows, and built-in slash commands from the model (v2.1.169). Affects only the upstream-shipped set — cc-settings' own skills, agents, and rules are unaffected. Useful when the bundled surface competes with project skills for the selector's attention. The env var `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1` is the per-session counterpart.

```json
{ "disableBundledSkills": true }
```

### `disableDeepLinkRegistration`

Disable Claude Code's deep-link URL handler registration on first launch (v2.1.103). Use in environments where the OS-level handler would conflict with another tool.

```json
{ "disableDeepLinkRegistration": true }
```

### `channelsEnabled` / `allowedChannelPlugins`

Channels are the team-distribution mechanism for plugins and managed configuration (v2.1.107 enterprise, expanded to console API key auth in v2.1.128). `channelsEnabled: true` opts an org into channel features. `allowedChannelPlugins` is the allowlist of plugin identifiers that channel admins can push.

```json
{
  "channelsEnabled": true,
  "allowedChannelPlugins": ["org/baseline-config", "org/reviewer-pack"]
}
```

### `allowedMcpServers` / `deniedMcpServers`

Managed MCP server policy lists (v2.1.112). Patterns are matched against MCP server URLs / identifiers. Use for enterprise allowlisting; supports scheme wildcards (e.g., `https://*.internal.example.com`).

```json
{
  "allowedMcpServers": ["https://*.internal.example.com", "claudeai-proxy"],
  "deniedMcpServers": ["http://*"]
}
```

### `allowAllClaudeAiMcps`

Managed setting (v2.1.149) that loads the claude.ai cloud MCP connectors alongside the locally-configured `managed-mcp.json`. Set `true` when an org wants the full claude.ai-distributed MCP catalogue in addition to its own allow/deny lists.

```json
{ "allowAllClaudeAiMcps": true }
```

### `enabledMcpjsonServers` / `disabledMcpjsonServers`

Per-server policy lists for MCP servers declared in project-level `.mcp.json` files. Values are server names (not URL patterns — that's `allowedMcpServers` / `deniedMcpServers`). Use to approve or reject specific entries from a checked-in `.mcp.json` without editing it.

```json
{
  "enabledMcpjsonServers": ["memory", "github"],
  "disabledMcpjsonServers": ["filesystem"]
}
```

### `cleanupPeriodDays`

Retention window (days) for session transcripts and orphaned subagent worktrees. Default `30`, minimum `1`; upstream rejects `0` with a validation error. Increase if you rely on past-chat search or long-window analysis; decrease to reclaim disk. To disable transcript writes entirely, set the `CLAUDE_CODE_SKIP_PROMPT_HISTORY` env var instead.

```json
{ "cleanupPeriodDays": 180 }
```

### `feedbackSurveyRate`

Sampling rate (0.0–1.0) for the in-session feedback survey (v2.1.106, enterprise). Set `0` to disable the prompt entirely. The OTel equivalent is gated by `CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL` (v2.1.136).

```json
{ "feedbackSurveyRate": 0 }
```

## Complete settings.json key reference

All ~104 documented top-level keys. Class column: **G** = General, **E** = Enterprise/Managed, **A** = Auth/Provider, **U** = UX.

| Key | Type | Class | Description |
|-----|------|-------|-------------|
| `$schema` | string | G | JSON Schema URL for editor IntelliSense |
| `agent` | string | G | Default agent name for subagent invocations; also honored by `claude agents` dispatched sessions (v2.1.157) |
| `allowAllClaudeAiMcps` | boolean | E | Load claude.ai cloud MCP connectors alongside managed-mcp.json (v2.1.149) |
| `allowManagedHooksOnly` | boolean | E | Block user-defined hooks; only managed hooks run |
| `allowManagedMcpServersOnly` | boolean | E | Block user-defined MCP servers |
| `allowManagedPermissionRulesOnly` | boolean | E | Block user-defined permission rules |
| `allowedChannelPlugins` | string[] | E | Allowlist of plugin identifiers channel admins can push (v2.1.107) |
| `allowedHttpHookUrls` | string[] | E | Allowlist of HTTP endpoints hooks may call |
| `allowedMcpServers` | string[] | E | Managed allowlist of MCP server URLs/identifiers (v2.1.112) |
| `alwaysThinkingEnabled` | boolean | G | Always show extended thinking even on short turns |
| `apiKeyHelper` | string | A | Shell command that emits an Anthropic API key |
| `attribution` | object | G | AI attribution in git commits/PRs (`commit`, `pr` string fields; `sessionUrl` boolean — `false` omits the claude.ai session link, v2.1.183) |
| `autoMemoryDirectory` | string | G | Custom directory for auto-memory storage (v2.1.101) |
| `autoMemoryEnabled` | boolean | G | Enable/disable the auto-memory system |
| `autoMode` | object | G | Auto-mode configuration object (shape evolving) |
| `autoScrollEnabled` | boolean | U | Auto-scroll to bottom as output streams in (v2.1.102) |
| `autoUpdatesChannel` | `"stable"` \| `"latest"` | G | Release channel to track for automatic updates |
| `availableModels` | string[] | E | Restrict the model picker to this list |
| `awaySummaryEnabled` | boolean | U | Show a session recap on re-entry after background work |
| `awsAuthRefresh` | string | A | Shell command called to refresh AWS credentials |
| `awsCredentialExport` | string | A | Shell command that exports AWS credential env vars |
| `blockedMarketplaces` | string[] | E | Marketplace IDs users cannot install from |
| `changelogUrl` | string | G | Override the URL `/release-notes` fetches from |
| `channelsEnabled` | boolean | E | Opt into channel-based plugin distribution (v2.1.128) |
| `cleanupPeriodDays` | integer ≥ 1 | G | Retention window for transcripts and orphaned worktrees (default 30) |
| `claudeMd` | string | E | Managed system-prompt override (replaces CLAUDE.md lookup) |
| `claudeMdExcludes` | string[] | G | Glob patterns for CLAUDE.md files to exclude |
| `companyAnnouncements` | string[] | E | Banner messages shown at session start |
| `defaultShell` | `"bash"` \| `"powershell"` | G | Shell used by the Bash tool |
| `deniedMcpServers` | string[] | E | Managed blocklist of MCP server URLs/identifiers (v2.1.112) |
| `disableAgentView` | boolean | E | Hide the agent-activity panel in the TUI |
| `disableAllHooks` | boolean | G | Master kill-switch for the entire hooks subsystem |
| `disableAutoMode` | `"disable"` | E | Disable auto-mode entirely (admin-tier) |
| `disableBundledSkills` | boolean | G | Hide Anthropic's bundled skills, workflows, and built-in slash commands from the model (v2.1.169; env counterpart `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS`) |
| `disableBypassPermissionsMode` | `"disable"` | E | Disable bypassPermissions mode (admin-tier) |
| `disableDeepLinkRegistration` | boolean | G | Disable deep-link URL handler registration on first launch (v2.1.103) |
| `disableRemoteControl` | boolean | E | Prevent remote-control / programmatic session takeover |
| `disableSkillShellExecution` | boolean | G | Block Skill tool inline shell execution (v2.1.98) |
| `disabledMcpjsonServers` | string[] | G | Blocklist for project .mcp.json server names |
| `editorMode` | `"normal"` \| `"vim"` | U | Input editor keybindings |
| `effortLevel` | `"low"` \| `"medium"` \| `"high"` \| `"xhigh"` \| `"max"` | G | Persist effort level across sessions (counterpart of `CLAUDE_CODE_EFFORT_LEVEL`; `max` is a superset beyond the key's docs) |
| `enableAllProjectMcpServers` | boolean | G | Auto-enable every server listed in .mcp.json |
| `enabledMcpjsonServers` | string[] | G | Allowlist for project .mcp.json server names |
| `enforceAvailableModels` | boolean | E | Make the `availableModels` allowlist also constrain the Default model; user/project cannot widen a managed list (v2.1.175) |
| `env` | Record\<string,string\> | G | Environment variables injected into every session |
| `fallbackModel` | string \| string[] | G | Up to three fallback models tried in order when the primary is overloaded/unavailable; settings.json counterpart of `--fallback-model` (v2.1.166) |
| `fastModePerSessionOptIn` | boolean | G | Per-session fast-mode opt-in flag |
| `feedbackSurveyRate` | number 0–1 | E | Sampling rate for in-session feedback survey; 0 = disabled (v2.1.106) |
| `fileSuggestion` | object | G | File-suggestion UI configuration object |
| `footerLinksRegexes` | array | G | Regex-matched link badges in the footer row; user or managed settings (v2.1.176) |
| `forceLoginMethod` | `"claudeai"` \| `"console"` | A | Lock the login flow to a specific provider |
| `forceLoginOrgUUID` | string \| string[] | A | Restrict login to a specific org UUID or list of UUIDs |
| `forceRemoteSettingsRefresh` | boolean | E | Force a settings reload from the managed settings URL |
| `gcpAuthRefresh` | string | A | Shell command called to refresh GCP credentials |
| `hooks` | object | G | Hook event handlers (PreToolUse, PostToolUse, etc.) |
| `httpHookAllowedEnvVars` | string[] | E | Env vars forwarded to HTTP hooks |
| `includeCoAuthoredBy` | boolean | G | Deprecated: use `attribution` instead |
| `includeGitInstructions` | boolean | G | Inject built-in git workflow instructions into the system prompt |
| `language` | string | G | UI language/locale override (e.g. `"en"`, `"ja"`) |
| `maxSkillDescriptionChars` | integer > 0 | G | Per-skill description character cap for the model |
| `mcpServers` | object | G | MCP server definitions (stdio and HTTP transports) |
| `minimumVersion` | string | E | Minimum Claude Code version required; older clients are blocked |
| `model` | string | G | Default model for all sessions (e.g. `"opus"`, `"sonnet"`) |
| `modelOverrides` | Record\<string,unknown\> | G | Map model picker entries to custom provider model IDs (v2.1.105) |
| `otelHeadersHelper` | string | G | Shell command that emits OTEL auth headers |
| `outputStyle` | string | G | Output rendering style override |
| `parentSettingsBehavior` | `"first-wins"` \| `"merge"` | E | How managed settings participate in the policy merge (admin-tier, v2.1.133) |
| `permissions` | object | G | Allow/deny/ask permission rules for tool invocations |
| `plansDirectory` | string | G | Directory where plan output files are written |
| `pluginTrustMessage` | string | E | Custom trust-confirmation message shown when installing plugins |
| `policyHelper` | object | E | Policy-helper configuration object (enterprise) |
| `prUrlTemplate` | string | G | Custom PR badge URL template; substitutes `{host}`, `{owner}`, `{repo}`, `{number}`, `{url}` (v2.1.119) |
| `preferredNotifChannel` | enum | U | Preferred desktop/terminal notification channel (`auto`, `terminal_bell`, `iterm2`, …) |
| `prefersReducedMotion` | boolean | U | Suppress animations in the TUI |
| `requiredMaximumVersion` | string | E | Managed: refuse to start if the Claude Code version is above this (v2.1.163) |
| `requiredMinimumVersion` | string | E | Managed: refuse to start if the Claude Code version is below this; pairs with `requiredMaximumVersion` to define an allowed range (v2.1.163) |
| `respectGitignore` | boolean | G | Honour .gitignore when listing files |
| `sandbox` | object | G | Sandbox configuration for secure command execution (v2.1.98–2.1.108) |
| `showClearContextOnPlanAccept` | boolean | U | Offer context-clear prompt after accepting a plan |
| `showThinkingSummaries` | boolean | U | Show inline thinking summaries in the conversation |
| `showTurnDuration` | boolean | U | Show per-turn elapsed time in the TUI |
| `skillListingBudgetFraction` | number | G | Fraction of context budget reserved for skill listings |
| `skillOverrides` | Record\<string,enum\> | G | Hide or trim individual skills from model/picker (v2.1.129) |
| `skipDangerousModePermissionPrompt` | boolean | G | Skip bypass-permissions confirmation prompt (ignored in project settings) |
| `skipWebFetchPreflight` | boolean | G | Skip preflight check before web-fetch tool calls |
| `spinnerTipsEnabled` | boolean | U | Show tips in the thinking spinner |
| `spinnerTipsOverride` | object | U | Suppress built-in spinner tips (`excludeDefault` boolean) (v2.1.122) |
| `spinnerVerbs` | object | U | Customize animated spinner verbs (`mode`, `verbs` fields) |
| `sshConfigs` | unknown[] | G | SSH tunnel/proxy configuration entries |
| `statusLine` | object | G | Custom status bar command displayed in the terminal |
| `strictKnownMarketplaces` | string[] | E | Allowlist of marketplace IDs considered trusted |
| `strictPluginOnlyCustomization` | boolean \| string[] | E | Restrict customization to plugin-provided items; `true` = all categories |
| `syntaxHighlightingDisabled` | boolean | U | Disable syntax highlighting in code blocks |
| `teammateMode` | `"auto"` \| `"in-process"` \| `"tmux"` | G | Agent Teams coordination mode |
| `terminalProgressBarEnabled` | boolean | U | Show a progress bar for long-running operations |
| `tui` | `"fullscreen"` \| `"default"` | U | TUI rendering mode (`fullscreen` uses alternate screen) |
| `useAutoModeDuringPlan` | boolean | G | Run auto-mode during the plan phase |
| `viewMode` | `"default"` \| `"verbose"` \| `"focus"` | U | Controls how much detail the TUI shows |
| `voice` | object | U | Voice input/output configuration object |
| `voiceEnabled` | boolean | U | Enable the voice interface |
| `wheelScrollAccelerationEnabled` | boolean | U | Toggle mouse-wheel scroll acceleration in fullscreen mode (v2.1.174) |
| `worktree` | object | G | Git worktree configuration (`baseRef`, `bgIsolation` fields) (v2.1.133) |
| `wslInheritsWindowsSettings` | boolean | E | WSL sessions inherit the Windows-side managed settings |

---

## Permissions

Permissions control which tool invocations are allowed, denied, or require user confirmation.

```json
{
  "permissions": {
    "allow": [...],
    "deny": [...],
    "ask": [...]
  }
}
```

### Permission Tiers

| Tier | Behavior | Use For |
|------|----------|---------|
| `allow` | Execute immediately, no confirmation | Safe, routine operations |
| `deny` | Block completely, cannot be overridden | Destructive or dangerous operations |
| `ask` | Prompt user for confirmation each time | Risky but sometimes needed operations |

If a tool invocation does not match any rule, Claude Code prompts the user (implicit `ask`).

### Permission Pattern Syntax

Patterns follow the format `ToolName(argument-pattern)`:

| Pattern | Matches |
|---------|---------|
| `Bash(git status:*)` | Any bash command starting with `git status` |
| `Bash(rm -rf node_modules)` | Exact command `rm -rf node_modules` only |
| `Read(*)` | Reading any file |
| `Read(~/.ssh/*)` | Reading files in `~/.ssh/` directory |
| `Write(~/.claude/settings.json)` | Writing to that specific file |
| `Bash(curl * \| bash)` | Any curl-to-bash pipe pattern |
| `Bash(sudo:*)` | Any command starting with `sudo` |
| `Agent(model:opus)` | Match a tool's input *parameter* — here, block Opus subagents (v2.1.178) |

The `:*` suffix means "followed by anything". Without it, the match is exact.

As of v2.1.178, rules can also match a tool's input parameters with `Tool(param:value)` syntax, where `value` supports the `*` wildcard — e.g. `Agent(model:opus)` matches subagent spawns requesting an Opus model. cc-settings does not yet ship any param-matched rules (`config/30-permissions.json` uses command/path patterns only), but the schema accepts them since permission rules are plain strings.

### Configured Allow / Deny Rules

> **Authoritative source:** the live allow/deny lists live in `config/30-permissions.json` (composed into `~/.claude/settings.json` at install). Run `bun run compose` to print the exact current set. This section summarizes the *shape and intent* — it intentionally does not re-list every rule, which drifts.

**Allow (runs without a prompt)** — a curated set of safe, non-interactive commands:

- **Runtime / build:** `bun`, `bunx`, `npm run`, `biome`
- **Git (read + common write):** `git status|diff|log|show|branch|add|commit|checkout|stash|push|blame|rev-parse|remote`, `gh`
- **Read-only / inspection:** `cat`, `head`, `tail`, `less`, `file`, `stat`, `which`, `type`, `echo`, `ls`, `pwd`, `tree`, `wc`
- **Search / text:** `grep`, `rg`, `diff`, `sort`, `uniq`, `cut`, `jq`
- **System info:** `du`, `df`, `printenv`, `date`, `uname`, `whoami`, `basename`, `dirname`, `realpath`
- **File ops:** `mkdir`, `cp`, `mv`, and scoped `rm` (`rm -rf node_modules|.next|dist|.turbo`, `rm *.tmp`)
- **Claude Code tools:** `Read`, `Write`, `Edit`, `MultiEdit`, `Glob`, `Grep`, `LS`, `TodoWrite`, `NotebookEdit`
- **External:** `lighthouse` (CLI; complemented by the chrome-devtools MCP), `open -a`

> **Deliberately NOT allowed (v11.7.0 hardening):** `curl`, `find`, `env`, `xargs`, `awk` are not in the allow list — each can invoke arbitrary commands (`find -exec`, `env VAR=x cmd`, `xargs cmd`, `awk 'system()'`, curl write/exfil flags) and would bypass every other rule, so they prompt instead. `vitest` was dropped too (the repo uses `bun test`).

**Deny (always blocked; overrides allow)** — grouped by intent:

- **Catastrophic deletion:** `rm -rf` of `/`, `/*`, `~`, `~/*`, `$HOME`, `~/.ssh|.gnupg|.aws` (plus `-fr`/`-Rf` variants); `find * -delete`, `xargs rm`.
- **Credential access:** read/copy/move/write of `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.netrc`, `~/.npmrc`, `~/.docker/config.json`, `~/.kube/config`.
- **Data exfiltration:** `curl` with `--data|-d|-F|-T|--upload-file|--json|--data-raw|--data-binary|-o|-O|-H|--header|--cookie|-X POST|PUT|DELETE|PATCH`; `curl|wget … | bash|sh`.
- **Config tampering (Shai-Hulud vector):** shell `cp`/`mv` *into* `~/.claude/settings.json`, `~/.claude.json`, `~/.bashrc`, `~/.zshrc`, `~/.bash_profile` — closes the gap where shell copy bypasses the `Write(...)` deny.
- **Destructive git:** `git push --force|-f|--force-with-lease`, `git reset --hard`, `git clean -f`, `git checkout -- .`, `git stash drop|clear`, `git restore .`.
- **Privilege / dangerous:** `sudo`, `chmod 777`, `gh repo delete`, `gh secret`, `gh api -X DELETE|--method DELETE`, `gh release delete`.
- **Remote code execution:** `node -e|-p|--eval|--print`, `awk … system(`, `find * -exec`.

#### Complete current rule list

<!-- BEGIN AUTOGEN:permissions -->
_Auto-generated from `config/30-permissions.json` — do not edit by hand; run `bun run docs:permissions`._

**Allow**

```
Bash(bun:*)
Bash(bunx:*)
Bash(npm run:*)
Bash(git status:*)
Bash(git diff:*)
Bash(git log:*)
Bash(git show:*)
Bash(git branch:*)
Bash(git add:*)
Bash(git commit:*)
Bash(git checkout:*)
Bash(git stash:*)
Bash(git push:*)
Bash(git blame:*)
Bash(git rev-parse:*)
Bash(git remote:*)
Bash(gh:*)
Bash(biome:*)
Bash(lighthouse:*)
Bash(npx react-doctor:*)
Bash(npx deslop:*)
Bash(open -a:*)
Bash(ls:*)
Bash(pwd:*)
Bash(tree:*)
Bash(wc:*)
Bash(file:*)
Bash(stat:*)
Bash(which:*)
Bash(type:*)
Bash(echo:*)
Bash(grep:*)
Bash(rg:*)
Bash(diff:*)
Bash(sort:*)
Bash(uniq:*)
Bash(cut:*)
Bash(jq:*)
Bash(du:*)
Bash(df:*)
Bash(printenv:*)
Bash(date:*)
Bash(uname:*)
Bash(whoami:*)
Bash(basename:*)
Bash(dirname:*)
Bash(realpath:*)
Bash(mkdir:*)
Bash(cp:*)
Bash(mv:*)
Bash(rm -rf node_modules)
Bash(rm -rf .next)
Bash(rm -rf dist)
Bash(rm -rf .turbo)
Bash(rm *.tmp)
Read(*)
Write(*)
Edit(*)
MultiEdit(*)
Glob(*)
Grep(*)
LS(*)
TodoWrite(*)
NotebookEdit(*)
```

**Deny**

```
Bash(rm -rf /)
Bash(rm -rf /*)
Bash(rm -rf ~)
Bash(rm -rf ~/*)
Bash(rm -rf ~/.ssh)
Bash(rm -rf ~/.gnupg)
Bash(rm -rf ~/.aws)
Bash(rm -rf $HOME:*)
Bash(rm -rf $HOME/*:*)
Bash(rm -fr /:*)
Bash(rm -fr /*:*)
Bash(rm -fr ~:*)
Bash(rm -fr ~/*:*)
Bash(rm -Rf /:*)
Bash(rm -Rf ~:*)
Read(~/.ssh/*)
Read(~/.aws/*)
Read(~/.gnupg/*)
Read(~/.config/gh/*)
Read(~/.netrc)
Bash(cat ~/.ssh/*)
Bash(cat ~/.aws/*)
Bash(cat ~/.gnupg/*)
Bash(cp ~/.ssh/*:*)
Bash(cp ~/.aws/*:*)
Bash(cp ~/.gnupg/*:*)
Bash(mv ~/.ssh/*:*)
Bash(mv ~/.aws/*:*)
Bash(mv ~/.gnupg/*:*)
Write(~/.ssh/*)
Write(~/.aws/*)
Write(~/.gnupg/*)
Bash(git push --force:*)
Bash(git push -f:*)
Bash(git reset --hard:*)
Bash(git clean -f:*)
Bash(git checkout -- .:*)
Bash(git checkout -- *)
Bash(git stash drop:*)
Bash(git stash clear:*)
Bash(git restore .:*)
Bash(git restore --staged .:*)
Bash(curl * | bash)
Bash(curl * | sh)
Bash(curl * --data:*)
Bash(curl * -d :*)
Bash(curl * -F :*)
Bash(curl * --upload-file:*)
Bash(curl * -T :*)
Bash(wget * | bash)
Bash(wget * | sh)
Bash(sudo:*)
Bash(chmod 777:*)
Bash(find * -delete:*)
Bash(xargs rm:*)
Read(~/.bashrc)
Read(~/.zshrc)
Read(~/.bash_profile)
Read(~/.npmrc)
Read(~/.docker/config.json)
Read(~/.kube/config)
Write(~/.bashrc)
Write(~/.zshrc)
Write(~/.bash_profile)
Write(~/.claude/settings.json)
Write(~/.claude.json)
Bash(gh repo delete:*)
Bash(gh secret:*)
Bash(gh api -X DELETE:*)
Bash(gh api * -X DELETE:*)
Bash(gh release delete:*)
Bash(cat ~/.netrc)
Bash(cat ~/.npmrc)
Bash(cat ~/.docker/config.json)
Bash(cat ~/.kube/config)
Bash(cat ~/.config/gh/*)
Bash(head ~/.netrc)
Bash(head ~/.npmrc)
Bash(head ~/.docker/config.json)
Bash(head ~/.kube/config)
Bash(head ~/.config/gh/*)
Bash(tail ~/.netrc)
Bash(tail ~/.npmrc)
Bash(tail ~/.docker/config.json)
Bash(tail ~/.kube/config)
Bash(tail ~/.config/gh/*)
Bash(cp ~/.netrc:*)
Bash(cp ~/.npmrc:*)
Bash(cp ~/.docker/config.json:*)
Bash(cp ~/.kube/config:*)
Bash(cp ~/.config/gh/*:*)
Bash(mv ~/.netrc:*)
Bash(mv ~/.npmrc:*)
Bash(mv ~/.docker/config.json:*)
Bash(mv ~/.kube/config:*)
Bash(mv ~/.config/gh/*:*)
Bash(curl * --json:*)
Bash(curl * --data-raw:*)
Bash(curl * --data-binary:*)
Bash(curl * --data-urlencode:*)
Bash(curl -X POST:*)
Bash(curl * -X POST:*)
Bash(curl -X PUT:*)
Bash(curl * -X PUT:*)
Bash(awk * system\(:*)
Bash(awk * system \(:*)
Bash(node -e:*)
Bash(node -p:*)
Bash(node --eval:*)
Bash(node --print:*)
Bash(curl * -o :*)
Bash(curl * -O:*)
Bash(curl * -H :*)
Bash(curl * --header :*)
Bash(curl * --cookie :*)
Bash(curl -X DELETE:*)
Bash(curl * -X DELETE:*)
Bash(curl -X PATCH:*)
Bash(curl * -X PATCH:*)
Bash(gh api --method DELETE:*)
Bash(gh api * --method DELETE:*)
Bash(find * -exec:*)
Bash(git push --force-with-lease:*)
Bash(cp * ~/.claude/settings.json:*)
Bash(mv * ~/.claude/settings.json:*)
Bash(cp * ~/.claude.json:*)
Bash(mv * ~/.claude.json:*)
Bash(cp * ~/.zshrc:*)
Bash(mv * ~/.zshrc:*)
Bash(cp * ~/.bashrc:*)
Bash(mv * ~/.bashrc:*)
Bash(cp * ~/.bash_profile:*)
Bash(mv * ~/.bash_profile:*)
```
<!-- END AUTOGEN:permissions -->

### `permissions.autoMode`

Configuration for auto-mode classifier behavior. cc-settings does not set this — included here for completeness and managed-settings authoring.

```json
{
  "permissions": {
    "autoMode": {
      "hard_deny": [
        "Bash(rm -rf /:*)",
        "Bash(sudo:*)"
      ]
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether auto-mode is active |
| `allowAll` | boolean | Allow everything not explicitly denied |
| `hard_deny` | list of permission rules | Block unconditionally regardless of user intent or allow exceptions (v2.1.136). Uses the same `Tool(pattern)` syntax as `permissions.deny`. Distinct from `permissions.deny` in that `hard_deny` cannot be overridden by elevated permission modes or user prompts |

---

## MCP Server Configuration

MCP (Model Context Protocol) servers extend Claude Code with external tool capabilities.

### Team-Shared MCP Servers (in `settings.json`)

```json
{
  "mcpServers": {
    "serverName": {
      "command": "executable",
      "args": ["arg1", "arg2"],
      "_comment": "Description of the server",
      "serverInstructions": "When to use this server"
    }
  }
}
```

### Configured Servers

#### context7

Library documentation lookup via the Context7 MCP protocol.

```json
{
  "context7": {
    "command": "bunx",
    "args": ["-y", "@upstash/context7-mcp"],
    "alwaysLoad": true,
    "serverInstructions": "Library and framework documentation lookup, API references, usage examples, and best practices."
  }
}
```

> **Note:** uses `bunx` rather than `npx` so monorepos that combine Bun's `catalog:` protocol with `overrides` in `package.json` don't break the server launch (`EOVERRIDE`). `alwaysLoad: true` (v2.1.121) opts the server out of `ENABLE_TOOL_SEARCH` deferral — docs lookup is hot-path and shouldn't pay the deferral round-trip.

**Tools provided:** `mcp__context7__resolve-library-id`, `mcp__context7__query-docs`

#### Sanity

Sanity CMS operations via remote HTTP.

```json
{
  "Sanity": {
    "type": "http",
    "url": "https://mcp.sanity.io",
    "serverInstructions": "Sanity CMS content and configuration operations including querying datasets, inspecting schemas, and managing content documents."
  }
}
```

Requires OAuth authentication on first use.

#### tldr

Semantic codebase analysis via the `llm-tldr` tool.

```json
{
  "tldr": {
    "command": "tldr-mcp",
    "args": ["--project", "."],
    "serverInstructions": "Semantic codebase analysis and repository-level search over the current project."
  }
}
```

**Prerequisite:** `pipx install llm-tldr`. Run `tldr warm .` in project to build index.

### MCP Server Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | Executable to run (for local servers) |
| `args` | list | Arguments to the executable |
| `type` | string | `"http"` for remote servers (default: local subprocess) |
| `url` | string | URL for HTTP-type servers |
| `alwaysLoad` | boolean | When `true`, all tools from this server skip tool-search deferral and are always available (v2.1.121). Use for hot-path servers like docs lookup |
| `_comment` | string | Human-readable description (ignored by Claude Code) |
| `serverInstructions` | string | Instructions for Claude on when/how to use this server |

### Per-User MCP Servers (in `~/.claude.json`)

Personal MCP servers that should not be shared with the team go in `~/.claude.json`:

```json
{
  "mcpServers": {
    "my-private-server": {
      "command": "my-mcp-server",
      "args": ["--config", "~/.my-config"]
    }
  }
}
```

This file is not checked into version control and is machine-specific.

---

## Hook Configuration

See [hooks-reference.md](./hooks-reference.md) for complete hook documentation.

Hooks are configured under the `hooks` key in `settings.json`. The structure is:

```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "ToolPattern",
        "hooks": [
          {
            "type": "command",
            "command": "shell command to run",
            "async": false,
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

---

## Settings Precedence

When the same setting exists in multiple locations, the resolution order is:

1. **Project `settings.json`** (highest priority for project-scoped settings)
2. **`~/.claude/settings.json`** (global defaults from cc-settings installer)
3. **`~/.claude.json`** (per-user MCP servers and personal overrides)
4. **Claude Code built-in defaults** (lowest priority)

For MCP servers specifically, servers from all config files are merged. If the same server name appears in multiple files, the project-level definition wins.

---

## Re-install Merge Behavior

Running `setup.sh` against an existing `~/.claude/settings.json` performs a **field-aware merge** rather than a wholesale overwrite. A full backup is always written to `~/.claude/backups/backup-<timestamp>.tar.gz` before any changes; recover with `bun src/setup.ts --rollback`.

### Non-interactive (default)

| Field | Policy |
|-------|--------|
| Top-level scalars (`model`, `statusLine`, `theme`, …) | **User wins when declared.** If you've set a value, re-install keeps it. Team fills in keys you haven't declared. |
| `permissions.allow` / `permissions.ask` / `permissions.additionalDirectories` | **Union.** Team entries always present; your additions are preserved. Order: team-original-order, then your extras. |
| `permissions.deny` | **Union (always additive).** Team denies re-appear even if you deleted them locally — they're safety guardrails. |
| `permissions.defaultMode` / `permissions.autoMode` | **User wins when declared.** |
| `hooks` | **Per-event union of groups.** Team's hooks (the ones that power cc-settings) run alongside any hooks you've added. Dedupe by structural equality. |
| `env` | **Shallow merge, user wins on conflict.** Your local `ENABLE_PROMPT_CACHING_1H=0` or debug flags stick across re-installs. |
| `mcpServers` | Interactive prompt per user-only server (unchanged behavior — see below). Override with `CC_WIPE_CUSTOM_MCP=1`. |

At the end of a merge the installer logs a one-line summary, e.g. `✓ Preserved user customization: 3 permission rule(s), 1 env override(s)`.

### Interactive mode

Run `bash setup.sh --interactive` (or `CC_INTERACTIVE=1 bash setup.sh`) to get fine-grained control over conflicts:

| Prompt | When |
|--------|------|
| `"<key>" differs between your settings and team: keep your value?` | Scalar conflict (user and team both declare the same key with different values). Covers top-level scalars, `permissions.defaultMode`/`autoMode`, and `env.*` conflicts. |
| `Team added N new allow rule(s) since your last install. Adopt these?` | Team's `permissions.allow` contains rules you don't have locally. Same prompt appears for `ask` and `additionalDirectories`. |
| `Team added N hook group(s) for <event>. Adopt these?` | Team registered new hook groups you don't have. |

`deny` rules, MCP servers, and user-only entries never prompt — denies are guardrails, MCP has its own dedicated prompt (kept from before), and user-only entries are strictly additive.

Hitting Enter on every prompt accepts the default (take team addition / keep your value), which reproduces the non-interactive output exactly. So `--interactive` is a safe way to see what the installer *would* do before committing.

### Why `--interactive` exists

Non-interactive "user wins when declared" has one known tradeoff: if the team file changes a scalar like `model` in a future release, users whose `settings.json` still contains the previous value won't pick up the update (the merger can't distinguish "user explicitly declared X" from "X is a stale copy from last install"). Interactive mode surfaces each such divergence so you can opt into team updates explicitly.

---

## MCP server notes

Notes on the MCP servers shipped in `config/20-mcp.json`. These were previously stored as `_comment` / `_status` keys inline in the JSON (non-standard; removed to keep the composed `settings.json` schema-clean).

- **context7**: Library documentation lookup. Auto-triggered by /docs skill and documentation-related prompts. alwaysLoad=true (v2.1.121) opts out of tool-search deferral — docs lookup is hot-path and shouldn't pay the deferral round-trip. Uses bunx so catalog:/overrides in monorepo package.json don't break npx resolution. (status: core)
- **tldr**: Requires: pipx install llm-tldr (v1.5+). Run 'tldr warm .' in project to index. (status: core)
- **figma**: Figma Dev Mode MCP (remote). Requires Dev or Full seat. OAuth on first use. (status: core)
- **chrome-devtools**: Chrome DevTools via CDP. Performance traces, network, console, user simulation. Uses bunx so catalog:/overrides in monorepo package.json don't break npx resolution. (status: core)
