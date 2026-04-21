# Settings Reference

Complete reference for all settings in `settings.json` and related configuration files.

---

## Configuration File Locations

| File | Scope | Contains |
|------|-------|----------|
| `settings.json` (project repo) | Team-shared, checked into git | Env vars, model, permissions, hooks, MCP servers |
| `~/.claude.json` | Per-user, machine-local | Personal MCP servers, user-specific overrides |
| `~/.claude/CLAUDE.md` | Per-user, global instructions | Behavioral instructions loaded into every session |
| `<project>/CLAUDE.md` | Per-project instructions | Project-specific behavioral instructions |

The installer (`setup.sh`) copies `settings.json` from this repo to `~/.claude/settings.json`, making it the global default for all projects.

---

## Top-Level Settings

### `env`

Environment variables injected into every Claude Code session.

```json
{
  "env": {
    "CLAUDE_CODE_EFFORT_LEVEL": "high",
    "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB": "1"
  }
}
```

| Variable | Values | Description |
|----------|--------|-------------|
| `CLAUDE_CODE_EFFORT_LEVEL` | `low`, `medium`, `high` | Default adaptive thinking depth. Platform default is `high` (since v2.1.94 for API/Team/Enterprise). cc-settings matches this default |
| `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` | `"1"` or unset | Strips credentials from subprocess environments. Security hardening |
| `CLAUDE_CODE_NO_FLICKER` | `"1"` or unset | Flicker-free alt-screen rendering. Pairs with `/tui fullscreen` |
| `CLAUDE_CODE_SCRIPT_CAPS` | integer (string) | Bounds per-session hook-script invocations. cc-settings sets `500` to guard against runaway hooks (v2.1.98+) |
| `ENABLE_PROMPT_CACHING_1H` | `"1"` or unset | Extends prompt cache TTL from 5 min → 1 hour. cc-settings enables this (v2.1.108+) |
| `SLASH_COMMAND_TOOL_CHAR_BUDGET` | number (string) | Override skill character budget (default: 2% of context window). Not set by default — let it auto-scale |
| `ENABLE_TOOL_SEARCH` | `auto:N` | MCP tool deferral threshold. Tools deferred when descriptions exceed N% of context |
| `CLAUDE_CODE_DISABLE_1M_CONTEXT` | `"true"` or unset | Opt out of 1M context window (Max plan default — rarely needed) |
| `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS` | `"true"` or unset | Suppress git status in system prompt (see also `includeGitInstructions` setting) |
| `CLAUDE_CODE_DISABLE_CRON` | `"true"` or unset | Disable scheduled cron jobs |
| `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` | milliseconds (string) | Timeout for SessionEnd hooks (default: 1500ms) |
| `ANTHROPIC_CUSTOM_MODEL_OPTION` | model ID string | Add a custom entry to the `/model` picker |

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
    "command": "bun \"$HOME/.claude/scripts/statusline.ts\""
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
    "sparsePaths": ["src/", "packages/shared/"]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sparsePaths` | list | Directories to check out in each worktree via git sparse-checkout. Useful for large monorepos |

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
Bash(pinchtab:*)          # Visual QA browser automation
Bash(lighthouse:*)        # Lighthouse performance audits
Bash(open -a:*)          # Launch macOS apps (e.g., Figma with debugging port)
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
    "command": "npx",
    "args": ["-y", "@upstash/context7-mcp"],
    "serverInstructions": "Library and framework documentation lookup, API references, usage examples, and best practices."
  }
}
```

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
