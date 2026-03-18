# Darkroom Engineering — Claude Code

> Claude-Code-specific configuration. For coding standards and guardrails, see AGENTS.md.

**Read and follow `AGENTS.md`** in the project root for all coding standards, guardrails, and conventions. This file contains only Claude-Code-specific settings.

---

## Edit Strategy

The Edit tool uses exact string matching. Follow these rules:

- **Small edits (<10 lines)**: Use `Edit` with minimal but unique `old_string`
- **Large edits (>15 lines)**: Use `Write` for full file replacement
- **On first Edit failure**: Switch to `Write` immediately
- **Re-read before editing**: If a file was read 2+ tool calls ago, re-read it

---

## Delegation

Use agents for complex tasks. Use tools directly for simple ones.

**Delegate when:**
- Multi-file exploration → `Agent(explore, "...")`
- Breaking down complex work → `Agent(planner, "...")`
- Multi-file implementation → `Agent(implementer, "...")`
- Code review → `Agent(reviewer, "...")`
- Writing tests → `Agent(tester, "...")`
- Security-sensitive code → `Agent(security-reviewer, "...")`
- Dead code cleanup → `Agent(deslopper, "...")`
- Expert Q&A / second opinions → `Agent(oracle, "...")`
- Scaffolding new components → `Agent(scaffolder, "...")`
- Complex multi-step tasks → `Agent(maestro, "...")`

**Act directly when:**
- Reading a specific file you know the path to
- Single-file edits under 20 lines
- Running a build or test command
- Simple searches (grep for a string, glob for a file)

**Parallelize**: when spawning multiple agents for independent work, send all Agent calls in a single message.

For full orchestration mode (power users), activate `profiles/maestro.md`.

---

## Model & Context

### Opus 4.6 (Default)
- Adaptive reasoning depth based on complexity
- 128K max output per response
- Fast mode: same model, faster output (`/fast`)
- Effort levels: `low`, `medium`, `high`

### Context Window
- Default: 1M tokens (Max/Team/Enterprise). Opt out with `CLAUDE_CODE_DISABLE_1M_CONTEXT`
- Skill character budget: auto-scales to 2% of context window (~80K chars at 1M)
- **Manual `/compact` at 70% context utilization** — auto-compaction triggers at 95% but don't let it get that far
- **Break subtasks to complete within 50% context** — prevents context rot mid-task
- **After compaction**: re-read task plan + active files before continuing (see AGENTS.md "Post-Compaction Recovery")

---

## Profiles

Activate for specialized workflows:

| Profile | Use Case |
|---------|----------|
| `maestro` | Full orchestration mode — agent delegation for everything |
| `nextjs` | Next.js web apps |
| `react-native` | Expo mobile apps |
| `tauri` | Tauri desktop apps (Rust + Web) |
| `webgl` | 3D web (R3F, Three.js, GSAP) |

---

## Agent Teams

For 3+ independent workstreams with no file conflicts:
- Enable: `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` in settings.json
- Display: `in-process` (Shift+Up/Down) or split panes
- Delegate mode: Shift+Tab to toggle
- File locking built-in

Use subagents (Agent) for dependent sequential tasks.
Use teams for independent parallel work.

---

## TLDR (Token-Efficient Exploration)

When `llm-tldr` is installed (v1.5+), prefer TLDR for large codebases. Language is auto-detected across 17 languages — no need to specify `--lang`.

| Instead of... | Use |
|---|---|
| Reading a large file | `tldr context functionName --project .` |
| Searching by meaning | `tldr semantic "description" .` |
| Finding callers | `tldr impact functionName .` |
| Architecture overview | `tldr arch .` |
| File tree | `tldr tree .` |
| Dead code | `tldr dead .` |

Use TLDR when it saves tokens. Use Read/Grep when you need exact content or small files.

---

## Cache-Friendly Context Ordering

Context ordering affects KV-cache hit rates. For maximum prefix cache reuse:

1. **Stable elements first** — system prompt, tool definitions, AGENTS.md rules
2. **Semi-stable next** — skill content, project context, loaded rules
3. **Dynamic elements last** — user messages, tool outputs, timestamps

Placing dynamic content (timestamps, user-specific data) early in context invalidates the cache prefix for everything after it. This ordering is mostly handled by Claude Code automatically, but be aware when constructing custom prompts or skill content.

---

## MCP Tool Deferral

When MCP tool descriptions exceed 10% of context, tools are auto-deferred.
Discovered on-demand via `ToolSearch`. Configure: `ENABLE_TOOL_SEARCH=auto:N`

---

## Hook Events

23 events across 7 categories:

**Session:** `SessionStart`, `SessionEnd`, `Setup`
**User:** `UserPromptSubmit`, `Notification`, `Stop`, `StopFailure`
**Tool:** `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`
**Agent:** `SubagentStart`, `SubagentStop`, `TeammateIdle`, `TaskCompleted`
**Context:** `PreCompact`, `PostCompact`, `InstructionsLoaded`, `ConfigChange`
**MCP:** `Elicitation`, `ElicitationResult`
**Worktree:** `WorktreeCreate`, `WorktreeRemove`

Types: `command` (shell), `prompt` (LLM yes/no), `agent` (subagent with tools), `http` (webhook)

---

## Knowledge System

Two-tier knowledge. See `docs/knowledge-system.md` for full details.

- **Shared** → GitHub Project board (team-wide decisions, gotchas, conventions)
- **Local** → Auto-memory + learnings (personal preferences, session context)
