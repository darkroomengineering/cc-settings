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
- Default effort: `xhigh` — pinned explicitly via `CLAUDE_CODE_EFFORT_LEVEL=xhigh` in `settings.json`. Anthropic's recommended setting for coding/agentic workflows on Opus 4.7 ([migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide)), and a guard against silent default downgrades like the Mar 4–Apr 7 2026 incident documented in Anthropic's [Apr 23 postmortem](https://www.anthropic.com/engineering/april-23-postmortem).
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
- **1M tokens** — default on Max plans. Use `opus[1m]` / `sonnet[1m]` aliases in settings.json to pin explicitly.
- On Max/Team/Enterprise: Opus 1M is included. Sonnet 1M requires extra usage.
- Subagents inherit the 1M context from the parent model setting.
- Skill character budget: auto-scales to 2% of context window (~80K chars at 1M)
- **Manual `/compact` at 65% context utilization** — Opus 4.7's tokenizer uses ~1-1.35x more tokens per text vs 4.6, so 65% is the new safe threshold (was 70% on 4.6). Auto-compaction still triggers at 95% but don't let it get that far.
- **Break subtasks to complete within 45% context** — conservative budget accounting for 4.7 tokenization. Prevents context rot mid-task.
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

## Prompt Caching

`ENABLE_PROMPT_CACHING_1H=1` extends cache TTL from 5 min → 1 hour (already set in settings.json). Override back with `FORCE_PROMPT_CACHING_5M=1`. See `docs/cache-strategy.md` for context-ordering details.

---

## MCP Tool Deferral

When MCP tool descriptions exceed 10% of context, tools are auto-deferred.
Discovered on-demand via `ToolSearch`. Configure: `ENABLE_TOOL_SEARCH=auto:N`

---

## Hooks

27 events across 8 categories. Types: `command`, `prompt`, `agent`, `http`. Conditional filtering via `if` field using permission rule syntax (e.g., `"if": "Bash(git commit*)"`). See `docs/hooks-reference.md` for full event list and examples.

Session auto-titling: a tiny `UserPromptSubmit` hook (`session-title.ts`) emits `hookSpecificOutput.sessionTitle` on the first meaningful prompt so `claude --resume <name>` (v2.1.101) and `/recap` work without manual `/rename`.

Skill matching is handled by the **native `Skill` tool** (v2.1.108) — no custom pattern-matching hook needed.

## Agent frontmatter

Agents declare capabilities in YAML frontmatter. cc-settings uses:

| Field | Purpose |
|-------|---------|
| `tools` | Allowlist of tools the agent may invoke |
| `disallowedTools` | Permission-rule-syntax blocklist, e.g. `["Bash(git push:*)", "Bash(rm:*)"]` (v2.1.84) |
| `maxTurns` | Cap turns for read-only agents (v2.1.84) |
| `permissionMode` | Permission mode honored when running as main-thread agent via `--agent` (v2.1.119). cc-settings uses `plan` for read-only agents (`explore`, `oracle`, `reviewer`, `security-reviewer`) |
| `effort` | Override effort level per-agent (v2.1.80) |
| `isolation: worktree` | Run in isolated git worktree copy |
| `hooks` | Fire when running as main-thread agent via `--agent` (v2.1.116) |
| `mcpServers` | Loaded for main-thread agent sessions via `--agent` (v2.1.117) |
| `initialPrompt` | Auto-submit first turn (v2.1.83) |

---

## Knowledge System

Two-tier knowledge. See `docs/knowledge-system.md` for full details.

- **Shared** → GitHub Project board (team-wide decisions, gotchas, conventions)
- **Local** → Auto-memory + learnings (personal preferences, session context)
