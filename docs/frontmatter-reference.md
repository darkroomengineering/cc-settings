# Frontmatter Reference

Complete reference for YAML frontmatter fields in agent definitions and skill files.

---

## Agent Frontmatter

**Location:** `~/.claude/agents/*.md`

Agent files define reusable personas that Claude Code can delegate work to via `Agent(agentName, "...")`.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Agent identifier, used in `Agent(name, "...")` invocations |
| `model` | string | No | Model to use: `opus` (default), `sonnet`, `haiku` |
| `memory` | string | No | Persistence scope: `user`, `project`, or `local`. Agents with memory retain learnings across sessions |
| `description` | string | Yes | Multi-line description shown in agent selection. Controls auto-invocation behavior (see below) |
| `tools` / `allowedTools` | list | No | Tools the agent can access. Both field names are accepted. Format: `[Read, Write, Edit, Bash, Grep, Glob, LS, Agent, ...]` |
| `color` | string | No | Display color in the UI: `purple`, `green`, `red`, `yellow`, `blue`, `cyan`, `magenta`, `gold` |
| `skills` | list | No | Skills to preload into the subagent context at startup |
| `mcpServers` | object | No | MCP servers scoped to this agent (inline definitions or references) |
| `hooks` | object | No | Lifecycle hooks scoped to this specific subagent |
| `maxTurns` | number | No | Maximum agentic turns before the subagent stops |
| `disallowedTools` | list | No | Tools to deny (removed from inherited tool list) |
| `background` | boolean | No | When `true`, always run this subagent as a background task |
| `isolation` | string | No | Set to `worktree` to run in a temporary git worktree for isolated repo access |
| `effort` | string | No | Effort level for this agent: `low`, `medium`, `high` |

### Auto-Invocation via `description`

The `description` field serves double duty. Beyond appearing in agent selection, certain keywords in the description trigger automatic delegation:

- Including `PROACTIVELY` or `Use this agent` causes Claude Code to auto-invoke the agent when it detects matching context in user prompts.
- Including `DELEGATE when user asks:` followed by example phrases helps the orchestrator route requests to the correct agent.
- Including `RETURNS:` documents what the agent produces, helping the orchestrator set expectations.

### Memory Scopes

| Scope | Persists Across | Storage |
|-------|-----------------|---------|
| `user` | All projects for this user | `~/.claude/memory/user/` |
| `project` | Sessions in this project | `~/.claude/memory/project/` |
| `local` | Current machine only | `~/.claude/memory/local/` |

Agents with `memory` enabled: `explore`, `reviewer`, `planner`, `oracle`.

### Example: Minimal Agent

```yaml
---
name: implementer
model: opus
description: |
  Code execution agent. Writes, edits, and tests code based on approved plans.
tools: [Read, Write, Edit, MultiEdit, Bash, Grep, Glob, LS, TodoWrite]
color: green
---
```

### Example: Agent with Memory

```yaml
---
name: explore
model: opus
memory: project
description: |
  Fast codebase exploration, navigation, and documentation fetching.
  DELEGATE when user asks:
  - "How does X work?" / "Where is X?"
  RETURNS: File locations, architecture maps, code summaries
tools: [Read, Grep, Glob, LS, Bash, WebFetch]
color: purple
---
```

### All Agents in cc-settings

| Agent | Model | Memory | Tools | Color |
|-------|-------|--------|-------|-------|
| `explore` | opus | project | Read, Grep, Glob, LS, Bash, WebFetch | purple |
| `implementer` | opus | -- | Read, Write, Edit, MultiEdit, Bash, Grep, Glob, LS, TodoWrite | green |
| `maestro` | opus | -- | Read, Write, Edit, MultiEdit, Bash, Grep, Glob, LS, TodoWrite, Agent | red |
| `reviewer` | opus | project | Read, Grep, Glob, LS, Bash | yellow |
| `planner` | opus | project | Read, Grep, Glob, LS | blue |
| `oracle` | opus | project | Read, Grep, Glob, LS, WebFetch, Bash | gold |
| `tester` | opus | -- | Read, Write, Edit, Bash, Grep, Glob, LS | cyan |
| `scaffolder` | opus | -- | Read, Write, Edit, Bash, Glob, LS | magenta |
| `deslopper` | opus | -- | Read, Edit, Grep, Glob, LS, Bash, Agent, AskUserQuestion, TeamCreate, SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet | cyan |
| `security-reviewer` | opus | -- | Read, Grep, Glob, Bash | red |

---

## Skill Frontmatter

**Location:** `~/.claude/skills/<skill-name>/SKILL.md`

Skills define slash commands (e.g., `/docs`, `/explore`) that users invoke directly or that the system activates automatically based on prompt patterns.

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | (required) | Skill identifier, used as the slash command name (e.g., `docs` for `/docs`) |
| `description` | string | (required) | Purpose description. Also used for auto-invocation pattern matching |
| `context` | string | `inherit` | Context behavior: `fork` (isolated context) or `inherit` (shared with parent) |
| `agent` | string | -- | Route execution to a specific agent (e.g., `explore`, `oracle`, `maestro`) |
| `allowed-tools` | list | -- | Tools available when the skill is active. Overrides default tool set |
| `disable-model-invocation` | boolean | `false` | When `true`, prevents the model from auto-invoking this skill |
| `user-invocable` | boolean | `true` | When `false`, hides from `/` command menu |
| `argument-hint` | string | -- | Hint text shown after the command name (e.g., `[project-name]`) |

### Invocation Control Matrix

| `disable-model-invocation` | `user-invocable` | Model can invoke? | User can /invoke? |
|---|---|---|---|
| `false` (default) | `true` (default) | Yes | Yes |
| `true` | `true` | No | Yes |
| `false` | `false` | Yes | No |
| `true` | `false` | No | No |

### Context Modes

| Mode | Behavior | Use When |
|------|----------|----------|
| `fork` | Creates an isolated sub-context. Output is summarized and returned to parent. Does not bloat main context. | Exploration, docs fetching, analysis tasks |
| `inherit` | Shares context with the parent conversation. | Skills that need to modify the current session state |

Skills using `fork`: `ask`, `autoresearch`, `build`, `checkpoint`, `consolidate`, `debug`, `design-tokens`, `discovery`, `docs`, `explore`, `f-thread`, `figma`, `fix`, `l-thread`, `lighthouse`, `orchestrate`, `prd`, `premortem`, `qa`, `refactor`, `review`, `ship`, `teams`, `test`, `tldr`, `verify`.

Skills using `inherit` (default): `audit`, `component`, `context`, `create-handoff`, `effort`, `hook`, `init`, `learn`, `lenis`, `project`, `resume-handoff`, `versions`.

### Agent Delegation

When `agent` is specified, the skill routes execution to that agent instead of running inline:

| Skill | Delegates to Agent |
|-------|--------------------|
| `ask` | `oracle` |
| `discovery` | `planner` |
| `explore` | `explore` |
| `orchestrate` | `maestro` |
| `premortem` | `oracle` |
| `review` | `reviewer` |
| `teams` | `maestro` |
| `test` | `tester` |

### Example: Skill with Fork and Agent Delegation

```yaml
---
name: explore
description: |
  Codebase exploration and understanding. Use when the user asks:
  - "how does X work?", "where is X?", "find X"
context: fork
agent: explore
---
```

### Example: Skill with Allowed Tools

```yaml
---
name: effort
description: |
  Dynamic effort level management. Use when:
  - User mentions "think harder", "be thorough", "quick fix"
allowed-tools:
  - Bash
argument-hint: "[low|medium|high]"
---
```

### Example: Skill with MCP Tools

```yaml
---
name: docs
description: |
  Fetch latest documentation for libraries and frameworks.
  CRITICAL - AUTO-INVOKE when user wants to implement with ANY external library.
context: fork
allowed-tools: [mcp__context7__resolve-library-id, mcp__context7__get-library-docs, WebFetch, WebSearch]
---
```

### All Skills in cc-settings

| Skill | Context | Agent | Allowed Tools | Argument Hint |
|-------|---------|-------|---------------|---------------|
| `ask` | fork | oracle | -- | -- |
| `audit` | -- | -- | -- | -- |
| `autoresearch` | fork | -- | -- | `<skill-name>` |
| `build` | fork | -- | -- | -- |
| `checkpoint` | fork | -- | Bash | -- |
| `component` | -- | -- | -- | -- |
| `consolidate` | fork | -- | -- | -- |
| `context` | -- | -- | -- | -- |
| `create-handoff` | -- | -- | -- | -- |
| `debug` | fork | -- | Bash | -- |
| `design-tokens` | fork | -- | -- | -- |
| `discovery` | fork | planner | -- | -- |
| `docs` | fork | -- | MCP context7 tools, WebFetch, WebSearch | -- |
| `effort` | -- | -- | Bash | `[low\|medium\|high]` |
| `explore` | fork | explore | -- | -- |
| `f-thread` | fork | -- | -- | -- |
| `figma` | fork | -- | Bash, MCP figma tools | -- |
| `fix` | fork | -- | -- | -- |
| `hook` | -- | -- | -- | -- |
| `init` | -- | -- | -- | `[project-name]` |
| `l-thread` | fork | -- | -- | -- |
| `learn` | -- | -- | -- | -- |
| `lenis` | -- | -- | -- | -- |
| `lighthouse` | fork | -- | Bash, Read, Write, Edit, MultiEdit, Grep, Glob, LS | `<url>` |
| `orchestrate` | fork | maestro | -- | -- |
| `prd` | fork | -- | -- | -- |
| `premortem` | fork | oracle | -- | -- |
| `project` | -- | -- | -- | -- |
| `qa` | fork | -- | Bash | -- |
| `refactor` | fork | -- | -- | -- |
| `resume-handoff` | -- | -- | -- | -- |
| `review` | fork | reviewer | -- | -- |
| `ship` | fork | -- | -- | -- |
| `teams` | fork | maestro | -- | -- |
| `test` | fork | tester | -- | -- |
| `tldr` | fork | -- | -- | -- |
| `verify` | fork | -- | -- | -- |
| `versions` | -- | -- | -- | -- |

---

## Rules Frontmatter

**Location:** `~/.claude/rules/*.md`

Rules are path-conditioned instructions loaded automatically based on which files are being discussed or edited.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `paths` | list | Glob patterns that trigger rule loading (e.g., `["**/*.tsx", "components/**/*"]`) |

### Example

```yaml
---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "components/**/*"
---

# React Component Rules
...
```

### Configured Rules

See `rules/README.md` for the current list of all available rules and their trigger paths.
