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

> **Opus 4.7 note**: Claude Opus 4.7 spawns fewer subagents by default than 4.6 and prefers internal reasoning over tool/agent use. The rules below are **not suggestions** — they are explicit triggers to counter that bias. When a trigger fires, delegate. Do not reason your way out of delegating "because you could do it yourself."

### You MUST delegate (non-negotiable) when:

- **Multi-file exploration spanning 3+ files** → `Agent(explore, "...")`
- **Any task that would require 10+ sequential tool calls** → break into agent tasks
- **Security-sensitive code** (auth, payments, crypto, input validation) → `Agent(security-reviewer, "...")`
- **Writing new test files** → `Agent(tester, "...")`
- **Dead code cleanup or codebase deslop** → `Agent(deslopper, "...")`
- **Parallel independent workstreams** (3+ with no file conflicts) → spawn agents in a single message

### You SHOULD prefer delegation for:

- **Complex multi-step implementation touching 2+ files** → `Agent(implementer, "...")`
- **Architecture decisions or upfront planning** → `Agent(planner, "...")`
- **Scaffolding new components/hooks/pages** → `Agent(scaffolder, "...")`
- **Code review on changes touching 3+ files** → `Agent(reviewer, "...")`
- **Expert second opinions on hard trade-offs** → `Agent(oracle, "...")`
- **Full-feature orchestration across 3+ agents** → `Agent(maestro, "...")`

### Act directly ONLY when:

- Reading a specific file you already know the path to
- Single-file edits under 20 lines
- Running a single build or test command
- Simple searches (one grep for a string, one glob for a file pattern)
- Answering a conversational question with no code change

### Enforcement Rules

1. **Parallelize**: when multiple delegations have no dependencies, send all `Agent` calls in a single message — they run concurrently.
2. **Don't narrate the decision**: if a trigger fires, call the Agent tool directly. Don't explain why you're delegating — just delegate.
3. **Don't self-override**: if you catch yourself thinking "I could just do this myself instead of spawning an agent," re-read the triggers above. The triggers exist because 4.7 biases toward self-execution.

For full orchestration mode (power users), activate `profiles/maestro.md`.

---

## Model & Context

### Opus 4.7 (Default)
- Adaptive reasoning depth based on complexity
- Fast mode: same model, faster output (`/fast`)
- Effort levels: `low`, `medium`, `high`, `xhigh`, `max` — set per-session with `/effort`, per-agent via `effort` frontmatter
- Default effort: `xhigh` (Anthropic's recommended setting for coding/agentic workflows on Opus 4.7 — see [migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide)).
  - Use `low` for trivial lookups and latency-sensitive work.
  - Use `medium` for routine edits where depth isn't required.
  - Use `high` for non-coding intelligence work (writing, analysis).
  - Use `max` only for extreme cases — often overthinks and shows diminishing returns.
- **Effort calibration is stricter on 4.7**: at `low` and `medium` the model scopes strictly to what was asked and may under-think complex problems. Raise effort rather than prompting around shallow reasoning.
- For hard multi-file debugging, "ultrathink" keyword triggers maximum reasoning depth for the next turn.
- Output token limits: 64K default, 128K upper bound.
- `/tui fullscreen` — flicker-free fullscreen rendering (pairs with `CLAUDE_CODE_NO_FLICKER=1`).
- `/focus` — toggle between normal and verbose transcript view.
- `/recap` — session recap; auto-triggers when returning to sessions, configurable via `/config`.

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
- **1M tokens** via `opus[1m]` / `sonnet[1m]` model aliases (configured in settings.json). Without the `[1m]` suffix, default is 200K.
- On Max/Team/Enterprise: Opus 1M is included. Sonnet 1M requires extra usage.
- Subagents inherit the 1M context from the parent model setting.
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

Set `ENABLE_PROMPT_CACHING_1H=1` for 1-hour prompt cache TTL (default is 5 minutes). Available on API key, Bedrock, Vertex, and Foundry. Use `FORCE_PROMPT_CACHING_5M=1` to override back to 5-minute default.

---

## MCP Tool Deferral

When MCP tool descriptions exceed 10% of context, tools are auto-deferred.
Discovered on-demand via `ToolSearch`. Configure: `ENABLE_TOOL_SEARCH=auto:N`

---

## Hook Events

27 events across 8 categories:

**Session:** `SessionStart`, `SessionEnd`, `Setup`
**User:** `UserPromptSubmit`, `Notification`, `Stop`, `StopFailure`
**Tool:** `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`
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
