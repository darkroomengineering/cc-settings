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

cc-settings publishes its own extended schemas at `raw.githubusercontent.com/darkroomengineering/cc-settings/main/schemas/` for *non-settings* files: `agent.schema.json`, `hooks-config.schema.json`, `skill.schema.json`, `claude-json.schema.json`. They're regenerated from `src/schemas/*.ts` via `bun run schemas:emit` (CI fails if you change a zod source without re-emitting — see `bun run schemas:check`).

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
| `CLAUDE_CODE_EFFORT_LEVEL` | `low`, `medium`, `high`, `xhigh`, `max` | Default adaptive thinking depth. cc-settings uses `xhigh` — Anthropic's recommended setting for coding and agentic workflows on Opus 4.7 ([migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide)) |
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
| `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE` | `"1"` or unset | Pin fast mode to Opus 4.6 (default is now Opus 4.7) (v2.1.142) |
| `CLAUDE_CODE_PLUGIN_PREFER_HTTPS` | `"1"` or unset | Clone GitHub plugin sources over HTTPS instead of SSH. For environments without a GitHub SSH key (v2.1.141) |
| `ANTHROPIC_WORKSPACE_ID` | UUID string | Scopes the workload-identity-federation minted token to a specific workspace (v2.1.141) |
| `CLAUDE_CODE_USE_POWERSHELL_TOOL` | `"0"` to opt out, unset for default | Now defaults on for Windows Bedrock/Vertex/Foundry users (v2.1.143) |

### `model`

Default model for all sessions.

```json
{
  "model": "opus"
}
```

| Value | Model | Notes |
|-------|-------|-------|
| `opus` | Claude Opus 4.7 | Default. Full capability, adaptive thinking. 1M context on Max |
| `sonnet` | Claude Sonnet 4.7 | Faster, lower cost. 1M context on Max |
| `haiku` | Claude Haiku 4.5 | Fastest, lowest cost |

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
| `manual` | Teammates require explicit direction |

### `attribution`

Controls AI attribution in git commits and PRs. Replaces the deprecated `coauthorship` setting.

```json
{
  "attribution": {
    "commit": "",
    "pr": ""
  }
}
```

Empty strings suppress attribution entirely. Darkroom policy: **no AI attribution**.

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
| `bwrapPath` | string | Linux/WSL: managed override for the bubblewrap binary location (v2.1.133) |
| `socatPath` | string | Linux/WSL: managed override for the socat binary location (v2.1.133) |

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
    "opus": "arn:aws:bedrock:us-west-2:...:foundation-model/anthropic.claude-opus-4-6-v1",
    "sonnet": "arn:aws:bedrock:us-west-2:...:foundation-model/anthropic.claude-sonnet-4-6-v1"
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

**Caveat:** Disabling hooks wholesale also silences `/goal` (which is implemented as a Stop hook) and the cc-settings `parallelmax-nudge` / `delegation-detector` / `parallelmax-judge` delegation guardrails. If `verify-hooks` warns you about suspicious hooks, remove the suspicious entries surgically rather than flipping this kill switch — see SECURITY.md "Don't disable hooks wholesale" for the full guidance.

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

### `disableSkillShellExecution`

Disable the Skill tool's ability to run inline shell commands (v2.1.98). Skills can still load text and prompt the model, but `bun ~/.claude/...` invocations from within a skill are blocked.

```json
{ "disableSkillShellExecution": true }
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

### `feedbackSurveyRate`

Sampling rate (0.0–1.0) for the in-session feedback survey (v2.1.106, enterprise). Set `0` to disable the prompt entirely. The OTel equivalent is gated by `CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL` (v2.1.136).

```json
{ "feedbackSurveyRate": 0 }
```

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

The `:*` suffix means "followed by anything". Without it, the match is exact.

### Configured Allow Rules

**Package managers and build tools:**

```
Bash(bun:*)           # All bun commands
Bash(bunx:*)          # All bunx commands
Bash(npm run:*)       # npm run scripts
Bash(biome:*)         # Biome linter/formatter
Bash(vitest:*)        # Vitest test runner
```

**Git operations:**

```
Bash(git status:*)    Bash(git diff:*)      Bash(git log:*)
Bash(git show:*)      Bash(git branch:*)    Bash(git add:*)
Bash(git commit:*)    Bash(git checkout:*)  Bash(git stash:*)
Bash(git push:*)      Bash(git blame:*)     Bash(git rev-parse:*)
Bash(git remote:*)    Bash(gh:*)
```

**Read-only commands:**

```
Bash(cat:*)       Bash(head:*)      Bash(tail:*)      Bash(less:*)
Bash(file:*)      Bash(stat:*)      Bash(which:*)     Bash(type:*)
Bash(echo:*)
```

**Search and text processing:**

```
Bash(grep:*)      Bash(rg:*)        Bash(find:*)      Bash(diff:*)
Bash(sort:*)      Bash(uniq:*)      Bash(cut:*)       Bash(awk:*)
Bash(sed -n:*)    Bash(jq:*)        Bash(xargs:*)
```

**System info:**

```
Bash(du:*)        Bash(df:*)        Bash(env:*)       Bash(printenv:*)
Bash(date:*)      Bash(uname:*)     Bash(whoami:*)    Bash(basename:*)
Bash(dirname:*)   Bash(realpath:*)  Bash(node -e:*)   Bash(node -p:*)
```

**File operations:**

```
Bash(ls:*)    Bash(pwd:*)    Bash(tree:*)    Bash(wc:*)
Bash(mkdir:*) Bash(cp:*)     Bash(mv:*)      Bash(curl:*)
```

**Safe cleanup:**

```
Bash(rm -rf node_modules)    Bash(rm -rf .next)
Bash(rm -rf dist)            Bash(rm -rf .turbo)
Bash(rm *.tmp)
```

**Claude Code tools:**

```
Read(*)    Write(*)    Edit(*)    MultiEdit(*)
Glob(*)    Grep(*)     LS(*)      TodoWrite(*)
NotebookEdit(*)
```

**External tools:**

```
Bash(lighthouse:*)        # Lighthouse performance audits (CLI; complemented by chrome-devtools MCP)
Bash(open -a:*)          # Launch macOS apps
```

### Configured Deny Rules

**Catastrophic file deletion:**

```
Bash(rm -rf /)         Bash(rm -rf /*)        Bash(rm -rf ~)
Bash(rm -rf ~/*)       Bash(rm -rf ~/.ssh)    Bash(rm -rf ~/.gnupg)
Bash(rm -rf ~/.aws)    Bash(rm -rf $HOME:*)
Bash(rm -fr /:*)       Bash(rm -Rf /:*)       # Alternate flag variants
Bash(find * -delete:*) Bash(xargs rm:*)
```

**Credential access:**

```
Read(~/.ssh/*)          Read(~/.aws/*)          Read(~/.gnupg/*)
Read(~/.config/gh/*)    Read(~/.netrc)
Bash(cat ~/.ssh/*)      Bash(cat ~/.aws/*)      Bash(cat ~/.gnupg/*)
Bash(cp ~/.ssh/*:*)     Bash(cp ~/.aws/*:*)
Write(~/.ssh/*)         Write(~/.aws/*)         Write(~/.gnupg/*)
```

**Data exfiltration:**

```
Bash(curl * --data:*)      Bash(curl * -d :*)
Bash(curl * -F :*)         Bash(curl * --upload-file:*)
Bash(curl * -T :*)
```

**Destructive git operations:**

```
Bash(git push --force:*)     Bash(git push -f:*)
Bash(git reset --hard:*)     Bash(git clean -f:*)
Bash(git checkout -- .:*)    Bash(git checkout -- *)
Bash(git stash drop:*)       Bash(git stash clear:*)
Bash(git restore .:*)        Bash(git restore --staged .:*)
```

**Remote code execution:**

```
Bash(curl * | bash)     Bash(curl * | sh)
Bash(wget * | bash)     Bash(wget * | sh)
```

**Privilege escalation and dangerous operations:**

```
Bash(sudo:*)            Bash(chmod 777:*)
Bash(gh repo delete:*)  Bash(gh secret:*)
```

**Shell and config modification:**

```
Read(~/.bashrc)         Read(~/.zshrc)          Read(~/.bash_profile)
Read(~/.npmrc)          Read(~/.docker/config.json)
Read(~/.kube/config)
Write(~/.bashrc)        Write(~/.zshrc)         Write(~/.bash_profile)
Write(~/.claude/settings.json)                  Write(~/.claude.json)
```

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

**Tools provided:** `mcp__context7__resolve-library-id`, `mcp__context7__get-library-docs`

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
