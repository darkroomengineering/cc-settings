# Darkroom Engineering — Claude Code

Read `AGENTS.md` for coding standards and guardrails. This file is Claude-Code-specific only.

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

For full orchestration mode, activate `profiles/maestro.md`. Model routing per agent: see `docs/agent-models.md`.

---

## Effort & Context

**Effort levels** — `low`, `medium`, `high`, `xhigh`, `max`. Default `xhigh` (pinned via `CLAUDE_CODE_EFFORT_LEVEL` in settings.json — guard against silent downgrades). Per-session: `/effort`. Per-agent: `effort` frontmatter.

- `low` — trivial lookups, latency-sensitive
- `medium` — routine edits where depth isn't required
- `high` — non-coding intelligence (writing, analysis)
- `max` — extreme cases only; often overthinks

**4.7 calibration is stricter**: at `low`/`medium` the model scopes strictly and may under-think. Raise effort rather than prompting around shallow reasoning. Use `ultrathink` keyword for one-turn maximum depth on hard multi-file debugging.

**Context window** — 1M tokens default on Max. Subagents inherit. Use `opus[1m]` / `sonnet[1m]` aliases in settings.json to pin.

- **Manual `/compact` at 65%** — Opus 4.7's tokenizer is ~1-1.35x heavier per text vs 4.6 (was 70% on 4.6). Auto-compaction triggers at 95%; don't wait for it.
- **Break subtasks to complete within 45%** — conservative budget for 4.7 tokenization. Prevents context rot mid-task.
- **After compaction**: re-read task plan + active files (see AGENTS.md "Post-Compaction Recovery").

Output token limits: 64K default, 128K upper bound.

---

## Reference

- **Profiles** (specialized workflows: `nextjs`, `react-native`, `tauri`, `webgl`, `maestro`) — see `docs/profiles.md`
- **TLDR** (token-efficient codebase exploration via `llm-tldr`) — see `docs/tldr-cheatsheet.md`
- **Hooks** (27 events, 8 categories, conditional `if` filtering) — see `docs/hooks-reference.md`
- **Agent frontmatter** (`tools`, `disallowedTools`, `maxTurns`, `permissionMode`, `effort`, `isolation`, `hooks`, `mcpServers`, `initialPrompt`) — see `docs/frontmatter-reference.md`
- **Knowledge system** (shared GitHub Project board + local auto-memory) — see `docs/knowledge-system.md`
- **Agent teams** (parallel independent workstreams, `teammateMode: "auto"`) — see `docs/feature-agents-guide.md`

Skill matching is handled by the native `Skill` tool (v2.1.108).
