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
| `memory` | string | No | Persistence scope: `user`, `project`, or `local`. Agents with memory retain learnings across sessions — see Memory Scopes below for the actual storage path |
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
| `effort` | string | No | Effort level for this agent: `low`, `medium`, `high`, `xhigh`, `max` |
| `permissionMode` | string | No | Permission mode for this agent's subagent session (used by `explore`, `reviewer`, `security-reviewer`) |
| `initialPrompt` | string | No | Text prepended to the agent's first turn, before the delegated task (used by `explore`) |

### Auto-Invocation via `description`

The `description` field serves double duty. Beyond appearing in agent selection, certain keywords in the description trigger automatic delegation:

- Including `PROACTIVELY` or `Use this agent` causes Claude Code to auto-invoke the agent when it detects matching context in user prompts.
- Including `DELEGATE when user asks:` followed by example phrases helps the orchestrator route requests to the correct agent.
- Including `RETURNS:` documents what the agent produces, helping the orchestrator set expectations.

### Memory Scopes

There's one storage convention regardless of scope value: `~/.claude/agent-memory/<agent-name>/MEMORY.md`
for the installed (user-wide) copy, or `<project-root>/.claude/agent-memory/<agent-name>/` when
project-scoped. The `memory:` value doesn't change *where* the file lives, only when the agent is
expected to read/write it. First 200 lines auto-load on the agent's next invocation — see
`AGENTS.md` "Self-Evolving Learnings".

Agents with `memory` enabled: `explore`, `reviewer`, `planner`.

### Example: Minimal Agent

```yaml
---
name: implementer
model: sonnet
description: |
  Code execution agent. Writes, edits, and tests code based on approved plans.
tools: [Read, Write, Edit, Bash, Grep, Glob, LS]
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
| `implementer` | sonnet | -- | Read, Write, Edit, Bash, Grep, Glob, LS | green |
| `maestro` | claude-opus-5 | -- | Read, Write, Edit, Bash, Grep, Glob, LS, Agent, SendMessage | red |
| `reviewer` | sonnet | project | Read, Grep, Glob, LS, Bash | yellow |
| `planner` | claude-opus-5 | project | Read, Grep, Glob, LS | blue |
| `tester` | sonnet | -- | Read, Write, Edit, Bash, Grep, Glob, LS | cyan |
| `scaffolder` | sonnet | -- | Read, Write, Edit, Bash, Glob, LS | magenta |
| `deslopper` | sonnet | -- | Read, Edit, Grep, Glob, LS, Bash, Agent, AskUserQuestion, SendMessage | cyan |
| `security-reviewer` | claude-opus-5 | -- | Read, Grep, Glob, Bash | red |
| `codex-verifier` | sonnet | -- | Bash, Read | cyan |

---

## Skill Frontmatter

**Location:** `~/.claude/skills/<skill-name>/SKILL.md`

Skills define slash commands (e.g., `/docs`, `/explore`) that users invoke directly or that the system activates automatically based on prompt patterns.

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | (required) | Skill identifier, used as the slash command name (e.g., `docs` for `/docs`) |
| `description` | string | (required) | Purpose description. Also used for auto-invocation pattern matching |
| `context` | string | omitted = inline | Context behavior: `fork` (isolated, backgrounded context) or `main` (runs inline in the main session — omitting the field resolves the same way) |
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
| `fork` | Creates an isolated sub-context and runs in the background by default (v2.1.218). Output is summarized and returned to the parent as a task notification, not streamed inline. Does not bloat main context. | Exploration, docs fetching, analysis tasks |
| `main` (or omitted — same behavior) | Shares context with the parent conversation, runs inline. | Skills that need to modify the current session state, or that are single-turn and lightweight |

There's no third `inherit` value — `context: inherit` is never written anywhere in the repo, and `src/schemas/skill.ts` defines the field as `z.enum(["fork", "main"])`.

Skills using `fork` (23): `autoresearch`, `build`, `checkpoint`, `consolidate`, `design-tokens`, `explore`, `fix`, `handoff`, `harvest`, `lighthouse`, `oracle`, `orchestrate`, `plan-ceo-review`, `plan-feature`, `qa`, `refactor`, `retro`, `review`, `ship`, `test`, `tldr`, `triage`, `verify`. All 23 run in the background by default as of v2.1.218 — invoking one hands the result back as a task notification instead of holding up the conversation.

Skills declaring `context: main` explicitly (5): `adhd`, `audit`, `codex`, `freeze`, `zero-tech-debt`.

Skills that omit `context` (10, same behavior as `main`): `cc`, `component`, `context-doc`, `dr-init`, `hook`, `project`, `proof-of-work`, `review-batch`, `share-learning`, `strategist`.

### Agent Delegation

When `agent` is specified, the skill routes execution to that agent instead of running inline:

| Skill | Delegates to Agent |
|-------|--------------------|
| `explore` | `explore` |
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
argument-hint: "[save|restore|show|list|clean] [name-or-id]"
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

### Installed skills

The executable frontmatter in each `skills/*/SKILL.md` file is the authority for context, tools,
arguments, and prerequisites. Use the [human skill guide](./skills.md) for value, effects, output,
host support, and nearby alternatives. The guide links every active executable source instead of
copying another frontmatter inventory here.

---

## Profile Frontmatter

**Location:** `~/.claude/profiles/*.md`

Profile files document specialized workflow intent for package detection, agents, and skills. They
are not activated through a settings key or `@profile-name` command. Use the relevant product
normally; cc-settings selects applicable guidance from repository evidence, while an explicit
`/orchestrate` in Claude or `$orchestrate` in Codex requests the broad coordinator.

All frontmatter fields in profiles are **advisory** — validated at install time for well-formedness and readable as documented intent. They are not enforced at runtime: cc-settings does not switch the active model, gate skills, or restrict tools based on a profile.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Profile identifier (kebab-case, must match the filename stem) |
| `description` | string | Yes | Short description of the profile's purpose |
| `model` | string | No | Advisory: intended model alias (`fable`, `opus`, `sonnet`, `haiku`, or a pinned variant like `claude-opus-5`) |
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
model: claude-opus-5
skills: [orchestrate]
effort: xhigh
---
```

### Profiles in cc-settings

| Profile | Model (advisory) | Skills (advisory) | Effort (advisory) |
|---------|-----------------|-------------------|-------------------|
| `maestro` | claude-opus-5 | orchestrate | xhigh |
| `nextjs` | claude-opus-5 | build, component, hook, lighthouse | — |
| `react-native` | claude-opus-5 | build, component | — |
| `tauri` | claude-opus-5 | build | — |
| `webgl` | claude-opus-5 | component, qa | — |
| `react-router` | claude-opus-5 | build, component, hook | — |

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
