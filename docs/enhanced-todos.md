# Enhanced Todo Structure

Extended todo format with dependencies, sizing, and parallel execution metadata.

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier (e.g., `T-1`) |
| `title` | string | Yes | Short description |
| `status` | enum | Yes | `pending`, `in_progress`, `completed`, `blocked` |
| `description` | string | No | Detailed description |
| `dependsOn` | string[] | No | IDs of tasks this depends on |
| `blocks` | string[] | No | IDs of tasks blocked by this |
| `priority` | 1-5 | No | 1=highest, 5=lowest |
| `complexity` | enum | No | `trivial`, `small`, `medium`, `large`, `epic` |
| `estimatedTokens` | number | No | Context window tokens needed |
| `parallelGroup` | number | No | Batch number for parallel execution |
| `verificationCriteria` | string | No | How to verify completion |

## Example

```json
{
  "id": "T-3",
  "title": "Build form components",
  "status": "pending",
  "description": "Create validated form for user settings page",
  "dependsOn": ["T-1"],
  "blocks": ["T-5", "T-6"],
  "priority": 2,
  "complexity": "medium",
  "estimatedTokens": 20000,
  "parallelGroup": 2,
  "verificationCriteria": "Component renders, form validates, tests pass"
}
```

## Dependency Management

### Rules
- No circular dependencies (enforced by cycle detection)
- A task cannot start until ALL `dependsOn` tasks are `completed`
- When a task completes, check if any `blocks` tasks become unblocked
- `blocks` is the inverse of `dependsOn` (maintained for convenience)

### Status Transitions

```
pending ──→ in_progress ──→ completed
   │              │
   └──→ blocked ──┘
         (when a dependency is not met)
```

- **pending → in_progress**: All dependencies completed, work begins
- **in_progress → completed**: Work done, verification passed
- **pending → blocked**: A dependency is added or fails
- **blocked → pending**: Blocking dependency resolves
- **blocked → in_progress**: Blocking dependency completes, work can resume

## Parallel Group Detection

Tasks are assigned `parallelGroup` numbers via topological sort (see `docs/parallel-batch-detection.md`).

```
parallelGroup 1: [T-1, T-3, T-7]  ← no dependencies
parallelGroup 2: [T-2, T-4]       ← depend on group 1
parallelGroup 3: [T-5]            ← depends on group 2
parallelGroup 4: [T-6, T-8]       ← depends on group 3
```

Tasks in the same `parallelGroup` can be executed concurrently.

## Priority Levels

| Level | Meaning | Scheduling |
|-------|---------|------------|
| 1 | Critical | Execute first within batch |
| 2 | High | Execute early |
| 3 | Normal | Default priority |
| 4 | Low | Execute after higher priority |
| 5 | Nice-to-have | Execute if time allows |

Within a parallel group, higher priority tasks are spawned first.

## Complexity Sizing

| Complexity | Estimated Tokens | Typical Scope |
|-----------|-----------------|---------------|
| `trivial` | 2,000 | Config change, copy update |
| `small` | 8,000 | Single component, utility function |
| `medium` | 20,000 | Feature slice, API endpoint |
| `large` | 50,000 | Multi-file feature, migration |
| `epic` | 100,000+ | Architecture change, new system |

## Context-Aware Scheduling

The scheduler respects context window limits:

1. **Budget**: Each batch must fit within 70% of remaining context
2. **Overflow**: If a batch exceeds budget, split into sub-batches
3. **Checkpoint**: Save state between batches for recovery
4. **Monitoring**: Track actual vs estimated token usage

```
remaining_budget = context_window * 0.70
for batch in batches:
  batch_cost = sum(task.estimatedTokens for task in batch)
  if batch_cost > remaining_budget:
    checkpoint()
    // New context window
    remaining_budget = context_window * 0.70
  execute(batch)
  remaining_budget -= actual_tokens_used
```

## Checkpoint Integration

Todo state is captured in every checkpoint:

```json
{
  "todos": {
    "completed": ["T-1", "T-2"],
    "remaining": ["T-3", "T-4", "T-5"],
    "blocked": ["T-5"],
    "inProgress": "T-3"
  }
}
```

On restore:
1. Load todo state from checkpoint
2. Verify completed tasks are still valid (git state matches)
3. Resume from first incomplete task
4. Re-check blocked status based on current completions
