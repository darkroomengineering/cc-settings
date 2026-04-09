---
name: orchestrate
description: |
  Use when:
  - User has a complex, multi-step task
  - Task requires multiple agents working together
  - User says "coordinate", "orchestrate", "complex task"
  - Work involves planning, implementation, testing, AND review
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
