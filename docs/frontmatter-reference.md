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
| `model` | string | No | Model to use: `fable`, `opus`, `sonnet`, `haiku` |
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
| `isolation` | string | No | `worktree` runs the agent in a temporary git worktree for isolated repo access; `remote` runs it in a remote/sandboxed environment |
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

Agents with `memory` enabled: `explore`, `reviewer`, `planner`.

### Example: Minimal Agent

```yaml
---
name: implementer
model: sonnet
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
model: sonnet
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
| `explore` | sonnet | project | Read, Grep, Glob, LS, Bash, WebFetch | purple |
| `implementer` | opus | -- | Read, Write, Edit, MultiEdit, Bash, Grep, Glob, LS, TodoWrite | green |
| `maestro` | opus | -- | Read, Write, Edit, MultiEdit, Bash, Grep, Glob, LS, TodoWrite, Agent | red |
| `reviewer` | opus | project | Read, Grep, Glob, LS, Bash | yellow |
| `planner` | opus | project | Read, Grep, Glob, LS | blue |
| `tester` | sonnet | -- | Read, Write, Edit, Bash, Grep, Glob, LS | cyan |
| `scaffolder` | sonnet | -- | Read, Write, Edit, Bash, Glob, LS | magenta |
| `deslopper` | sonnet | -- | Read, Edit, Grep, Glob, LS, Bash, Agent, AskUserQuestion, TeamCreate, SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet | cyan |
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

Skills using `fork` (21): `autoresearch`, `build`, `checkpoint`, `consolidate`, `design-tokens`, `explore`, `fix`, `handoff`, `lighthouse`, `oracle`, `orchestrate`, `plan-ceo-review`, `plan-feature`, `qa`, `refactor`, `retro`, `review`, `ship`, `test`, `tldr`, `verify`.

Skills using `main` (3): `freeze`, `nuclear-review`, `zero-tech-debt`.

Skills using `inherit` (default, 10): `cc`, `component`, `context-doc`, `dr-init`, `hook`, `project`, `proof-of-work`, `review-batch`, `share-learning`, `strategist`.

### Agent Delegation

When `agent` is specified, the skill routes execution to that agent instead of running inline:

| Skill | Delegates to Agent |
|-------|--------------------|
| `explore` | `explore` |
| `oracle` | `explore` |
| `orchestrate` | `maestro` |
| `plan-feature` | `planner` |
| `review` | `reviewer` |
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
name: checkpoint
description: |
  Save session state snapshots. Use when:
  - User says "checkpoint", "save state", "save progress"
allowed-tools:
  - Bash
argument-hint: "[save|restore|list] [name]"
---
```

### Example: Skill with MCP Tools

```yaml
---
name: autoresearch
description: |
  Optimize or improve a skill prompt via automated research.
  CRITICAL - AUTO-INVOKE when user says "autoresearch", "optimize skill", "improve skill prompt".
context: fork
allowed-tools: [Read, Grep, Glob, Bash]
argument-hint: "<skill-name>"
---
```

### All Skills in cc-settings

| Skill | Context | Agent | Allowed Tools | Argument Hint |
|-------|---------|-------|---------------|---------------|
| `autoresearch` | fork | -- | -- | `<skill-name>` |
| `build` | fork | -- | -- | -- |
| `cc` | -- | -- | -- | -- |
| `checkpoint` | fork | -- | Bash | -- |
| `component` | -- | -- | -- | -- |
| `consolidate` | fork | -- | -- | -- |
| `context-doc` | -- | -- | -- | -- |
| `design-tokens` | fork | -- | -- | -- |
| `dr-init` | -- | -- | -- | `[project-name]` |
| `explore` | fork | explore | -- | -- |
| `fix` | fork | -- | -- | -- |
| `freeze` | main | -- | Bash, AskUserQuestion | -- |
| `handoff` | fork | -- | -- | -- |
| `hook` | -- | -- | -- | -- |
| `lighthouse` | fork | -- | Bash, Read, Write, Edit, MultiEdit, Grep, Glob, LS | `<url>` |
| `nuclear-review` | main | -- | -- | -- |
| `oracle` | fork | explore | -- | -- |
| `orchestrate` | fork | maestro | -- | -- |
| `plan-ceo-review` | fork | -- | Read, Grep, Glob, Bash, AskUserQuestion | -- |
| `plan-feature` | fork | planner | -- | -- |
| `project` | -- | -- | -- | -- |
| `proof-of-work` | -- | -- | -- | -- |
| `qa` | fork | -- | Bash | -- |
| `refactor` | fork | -- | -- | -- |
| `retro` | fork | -- | Bash, Read, Write, Glob | -- |
| `review` | fork | reviewer | -- | -- |
| `review-batch` | -- | -- | -- | -- |
| `share-learning` | -- | -- | -- | -- |
| `ship` | fork | -- | -- | -- |
| `strategist` | -- | -- | Read, Grep, Glob, Bash | -- |
| `test` | fork | tester | -- | -- |
| `tldr` | fork | -- | -- | -- |
| `verify` | fork | -- | -- | -- |
| `zero-tech-debt` | main | -- | -- | -- |

---

## Profile Frontmatter

**Location:** `~/.claude/profiles/*.md`

Profile files inject specialized instructions for a particular workflow context. They are activated via `@profile-name` references in CLAUDE.md or per-project setup.

All frontmatter fields in profiles are **advisory** — validated at install time for well-formedness and readable as documented intent. They are not enforced at runtime: cc-settings does not switch the active model, gate skills, or restrict tools based on a profile.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Profile identifier (kebab-case, must match the filename stem) |
| `description` | string | Yes | Short description of the profile's purpose |
| `model` | string | No | Advisory: intended model alias (`fable`, `opus`, `sonnet`, `haiku`, or a pinned variant like `opus[1m]`) |
| `skills` | list | No | Advisory: skill names expected to be active in this context |
| `tools` | list | No | Advisory: tool subset relevant to this workflow |
| `permissionMode` | string | No | Advisory: intended permission mode (`default`, `manual`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`) |
| `effort` | string | No | Advisory: default effort level (`low`, `medium`, `high`, `xhigh`, `max`) |

### Example: Profile with Advisory Fields

```yaml
---
name: maestro
description: |
  Full orchestration mode for power users. Coordinates agents instead of executing directly.
  Activate when you want maximum delegation and parallel agent workflows.
model: opus
skills: [orchestrate]
effort: xhigh
---
```

### Profiles in cc-settings

| Profile | Model (advisory) | Skills (advisory) | Effort (advisory) |
|---------|-----------------|-------------------|-------------------|
| `maestro` | opus | orchestrate | xhigh |
| `nextjs` | opus | build, component, hook, lighthouse | — |
| `react-native` | opus | build, component | — |
| `tauri` | opus | build | — |
| `webgl` | opus | component, qa | — |
| `react-router` | opus | build, component, hook | — |

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
