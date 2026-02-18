# Thread Types

Five thread types for different task patterns. Choose based on task complexity, independence, and duration.

## Overview

| Type | Name | Agents | Use Case |
|------|------|--------|----------|
| **B** | Base | 1 | Simple single-agent task |
| **P** | Parallel | N (concurrent) | Independent tasks |
| **C** | Chained | N (sequential) | Dependent pipeline |
| **F** | Fusion | N (concurrent + merge) | Compare approaches |
| **L** | Long-duration | 1 (with checkpoints) | Overnight autonomous |

## B-Thread: Base

Single agent, single task. The default.

```
User → Task(implementer, "fix the bug") → Done
```

**When:** Simple, unambiguous, single-file or small scope.

**Verification:** Level 1-2 (compile, lint).

## P-Thread: Parallel

Multiple independent agents running concurrently.

```
User → Task(implementer, "component A") + Task(implementer, "component B") → Done
```

**When:** Tasks share no dependencies. Files don't overlap.

**Verification:** Level 1-3 per agent, then integration check.

**Rules:**
- Spawn all agents in ONE message
- Tasks must not modify the same files
- Each agent verifies independently

## C-Thread: Chained

Sequential pipeline where each agent depends on the previous.

```
User → Task(explore, "understand system")
     → Task(planner, "design solution")
     → Task(implementer, "build it")
     → Task(tester, "test it")
     → Task(reviewer, "review it")
     → Done
```

**When:** Each step needs output from the previous step.

**Verification:** Final agent runs full verification (Levels 1-5).

## F-Thread: Fusion

Parallel evaluation of alternatives, then merge into a decision.

```
User → Define criteria
     → Task(oracle, "evaluate A") + Task(oracle, "evaluate B") + Task(oracle, "evaluate C")
     → Scoring matrix
     → ADR recommendation
     → Done
```

**When:** Architecture decisions, technology selection, approach comparison.

**Verification:** Not code-level; validates scoring methodology and completeness.

See: `skills/f-thread/SKILL.md` for full specification.

## L-Thread: Long-Duration

Single agent executing autonomously with checkpoint/restore across context windows.

```
User → Task(planner, "phase the work")
     → Execute Phase 1 → Checkpoint
     → Execute Phase 2 → Checkpoint
     → [context exhausted, new session]
     → Restore checkpoint
     → Execute Phase 3 → Checkpoint
     → ...
     → Final verification → <promise>COMPLETE</promise>
```

**When:** Task exceeds single context window. Large migrations, full features.

**Verification:** Full stack (Levels 1-5) at completion, Levels 1-3 at each checkpoint.

See: `skills/l-thread/SKILL.md` for full specification.

## Decision Tree

```
Is it a single, simple task?
  YES → B-Thread

Are there multiple independent tasks?
  YES → P-Thread

Do tasks depend on each other sequentially?
  YES → C-Thread

Are you comparing multiple approaches?
  YES → F-Thread

Will it exceed a single context window?
  YES → L-Thread
```

## Combination Patterns

Threads can be composed:

### C + P (Chained with Parallel phases)
```
explore → planner → [implementer A + implementer B] → tester → reviewer
                     ^-- parallel phase --^
```
Most common pattern for medium features.

### L + P (Long-duration with Parallel batches)
```
Phase 1: [task A + task B]  → checkpoint
Phase 2: [task C + task D]  → checkpoint
Phase 3: [task E]           → checkpoint
Final verification
```
Used for large migrations with independent components.

### F + C (Fusion then Chain)
```
[oracle A + oracle B + oracle C] → decision → planner → implementer
^-- fusion comparison --^          ^-- chain to implementation --^
```
Decide approach, then implement.

## Verification Levels per Thread Type

| Thread | Checkpoint Verification | Final Verification |
|--------|------------------------|-------------------|
| B | N/A | Levels 1-2 |
| P | Per-agent: Levels 1-2 | Levels 1-3 + integration |
| C | Per-step: as needed | Levels 1-5 (full) |
| F | N/A (no code) | Scoring completeness |
| L | Levels 1-3 at each checkpoint | Levels 1-5 (full) |
