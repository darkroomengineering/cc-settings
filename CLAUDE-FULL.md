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
- Fast mode: same model, faster output (`/fast`)
- Effort levels: `low`, `medium`, `high` — set per-session with `/effort`, per-agent via `effort` frontmatter
- Default effort: `high` (since v2.1.94 for API/Team/Enterprise users). Use `low` for trivial lookups, `medium` for routine edits.
- For hard multi-file debugging, "ultrathink" keyword triggers maximum reasoning depth for the next turn.

### Model Routing (Opus + Sonnet)

Opus is reserved for tasks requiring deep reasoning. Sonnet handles mechanical work to conserve Opus quota. Both get 1M context on Max plans.

| Agent | Model | Rationale |
|-------|-------|-----------|
| `maestro` | **opus** | Orchestration needs strongest reasoning |
| `planner` | **opus** | Architecture decisions need depth |
| `oracle` | **opus** | Expert Q&A needs nuance |
| `security-reviewer` | **opus** | Can't afford missed vulnerabilities |
| `reviewer` | **opus** | Code review needs careful judgment |
| `implementer` | **sonnet** | Code writing is well-defined work |
| `tester` | **sonnet** | Test writing follows clear patterns |
| `scaffolder` | **sonnet** | Boilerplate generation is mechanical |
| `explore` | **sonnet** | File search/read doesn't need deep reasoning |
| `deslopper` | **sonnet** | Pattern matching for dead code is straightforward |

Override per-invocation when needed: `Agent(implementer, "...", model: "opus")` for complex implementations.

### Context Window
- **1M tokens** for both Opus and Sonnet on Max plans — subagents get full 1M regardless of model
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
- Set `teammateMode: "auto"` in settings.json (already configured)
- Display: `in-process` (Shift+Up/Down) or split panes
- Delegate mode: Shift+Tab to toggle
- File locking built-in
- Agents can declare `isolation: worktree` for isolated git worktree copies
- Agents can declare `background: true` to always run as background tasks

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

26 events across 8 categories:

**Session:** `SessionStart`, `SessionEnd`, `Setup`
**User:** `UserPromptSubmit`, `Notification`, `Stop`, `StopFailure`
**Tool:** `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`
**Agent:** `SubagentStart`, `SubagentStop`, `TeammateIdle`, `TaskCompleted`, `TaskCreated`
**Context:** `PreCompact`, `PostCompact`, `InstructionsLoaded`, `ConfigChange`
**Environment:** `CwdChanged`, `FileChanged`
**MCP:** `Elicitation`, `ElicitationResult`
**Worktree:** `WorktreeCreate`, `WorktreeRemove`

Types: `command` (shell), `prompt` (LLM yes/no), `agent` (subagent with tools), `http` (webhook POST/response)

Hooks support conditional `if` field using permission rule syntax (e.g., `"if": "Bash(git commit*)"`) to filter when they fire.

---

## Knowledge System

Two-tier knowledge. See `docs/knowledge-system.md` for full details.

- **Shared** → GitHub Project board (team-wide decisions, gotchas, conventions)
- **Local** → Auto-memory + learnings (personal preferences, session context)
