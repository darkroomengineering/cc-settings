---
name: orchestrate
description: Coordinate multi-agent complex task across plan/implement/test/review, including parallel fan-out for 3+ independent workstreams (formerly `/teams`). Triggers "coordinate", "orchestrate", "complex task", "use teams", "parallel agents", "split work", "fan out", "divide and conquer", "multi-instance", large-scale refactor, multi-step work needing multiple agents.
context: fork
agent: maestro
---

# Multi-Agent Orchestration

Before starting work, create a marker: `mkdir -p ~/.claude/tmp && echo "orchestrate" > ~/.claude/tmp/heavy-skill-active && date -u +"%Y-%m-%dT%H:%M:%SZ" >> ~/.claude/tmp/heavy-skill-active`

## Phase 1: Research & Feasibility (GO/NO-GO Gate)

Before delegating to agents:

1. **Parse requirements** - Break down what needs to happen
2. **Identify workstreams** - Which are independent? Which have dependencies?
3. **Assess scope** - Is this actually multi-agent work, or simpler than it looks?

**GO/NO-GO Verdict**:
- **GO** - Task has 3+ workstreams, clear boundaries, and agents can work independently. Proceed.
- **SIMPLIFY** - Task has <3 workstreams. Use direct Agent() delegation instead.
- **NO-GO** - Requirements unclear, scope too large, or high risk of file conflicts. Report and stop.

Do not proceed past this gate without an explicit verdict.

## Phase 2: Orchestrate

Delegate to the Maestro agent for multi-agent task orchestration.

The Maestro agent handles: agent selection, parallel execution, workflow coordination, and agent teams.

For simple delegation (1-2 agents), use Agent() directly without invoking this skill.

## When to Fan Out (Teams mode)

Use full parallel team fan-out instead of sequential subagent delegation when:

| Scenario | Fan out? | Why |
|----------|----------|-----|
| 3+ independent file areas | Yes | Maximum parallelism, isolated context per agent |
| Frontend + Backend + Tests | Yes | No file conflicts, clear boundaries |
| Large codebase analysis | Yes | Independent context per agent prevents bleed |
| Competing approaches | Yes | Explore alternatives in parallel before deciding |
| Sequential dependent work | No | Use subagents in sequence; fan-out adds overhead |
| Quick single investigation | No | Overhead not worth it; use `/explore` directly |

### Prerequisites for fan-out

- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` must be set (enabled by default in cc-settings)
- For split panes: tmux or iTerm2 recommended

## Output

Report: team composition (when fan-out chosen), task assignments, coordination strategy, and progress.
