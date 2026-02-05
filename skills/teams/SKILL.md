---
name: teams
description: |
  Agent Teams orchestration for multi-instance parallel work. Use when:
  - User mentions "use teams", "parallel agents", "split work", "fan out"
  - Task has 3+ independent workstreams
  - Large-scale refactoring across unrelated files
  - User says "divide and conquer", "multi-instance"
context: fork
agent: maestro
---

# Agent Teams Orchestration

Coordinate multiple independent Claude Code instances for true parallelism.

## Prerequisites

- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` must be set (enabled by default in cc-settings)
- For split panes: tmux or iTerm2 recommended

## When to Use Teams

| Scenario | Teams? | Why |
|----------|--------|-----|
| 3+ independent file areas | Yes | Maximum parallelism |
| Frontend + Backend + Tests | Yes | No file conflicts |
| Sequential dependent work | No | Use subagents instead |
| Quick single investigation | No | Overhead not worth it |
| Large codebase analysis | Yes | Independent context per agent |
| Competing approaches | Yes | Explore in parallel |

## Patterns

### Fan-Out Implementation
```
Lead (Maestro): Coordinate only (delegate mode)
Teammate 1: Implement components/ changes
Teammate 2: Implement lib/ changes
Teammate 3: Write tests for both
Shared task list for self-coordination
```

### Parallel Exploration
```
Lead: Synthesize findings
Teammate 1: Explore approach A
Teammate 2: Explore approach B
Teammate 3: Research existing patterns in codebase
```

### Cross-Layer Feature
```
Lead: Define interfaces, coordinate
Teammate 1: API routes + validation
Teammate 2: UI components + styling
Teammate 3: State management + hooks
Teammate 4: Tests + documentation
```

## Safety

- File locking prevents race conditions automatically
- Plan approval mode: teammates plan before executing (lead approves)
- Delegate mode: lead coordinates only, never implements directly
- Clear file boundaries assigned per teammate

## Display Modes

- **in-process**: All in one terminal, navigate with Shift+Up/Down
- **split panes**: Each teammate in own pane (tmux/iTerm2)
- **auto**: Picks best option for your terminal

## Output

Report: team composition, task assignments, coordination strategy, and progress.
