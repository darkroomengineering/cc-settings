# Parallel Batch Detection Algorithm

Detects which tasks can run in parallel by analyzing dependency graphs. Used by maestro and PRD generation.

## Core Algorithm: Kahn's Topological Level Detection

Tasks form a DAG (Directed Acyclic Graph) where edges represent dependencies. Tasks at the same topological level have no dependencies on each other and can run in parallel.

### Steps

1. **Build DAG**: Create adjacency list from task `dependsOn` fields
2. **Compute in-degrees**: Count incoming edges per node
3. **Level assignment**: BFS from zero-in-degree nodes, assigning levels
4. **Group by level**: Tasks at the same level form a parallel batch

### Pseudocode

```
function detectBatches(tasks):
  // Build graph
  graph = {}
  inDegree = {}
  for task in tasks:
    graph[task.id] = []
    inDegree[task.id] = 0

  for task in tasks:
    for dep in task.dependsOn:
      graph[dep].push(task.id)
      inDegree[task.id] += 1

  // BFS level detection
  queue = [t for t in tasks if inDegree[t.id] == 0]
  level = 0
  batches = []

  while queue not empty:
    batches[level] = queue.copy()
    nextQueue = []
    for taskId in queue:
      for neighbor in graph[taskId]:
        inDegree[neighbor] -= 1
        if inDegree[neighbor] == 0:
          nextQueue.push(neighbor)
    queue = nextQueue
    level += 1

  return batches
```

## DAG Construction

From todo items with dependency fields:

```
T-1: Setup models         (no deps)
T-2: API endpoints        (depends: T-1)
T-3: UI scaffolding       (no deps)
T-4: Form components      (depends: T-3)
T-5: Integration          (depends: T-2, T-4)
T-6: Tests                (depends: T-5)
T-7: Test fixtures        (no deps)
```

DAG:
```
T-1 → T-2 ─┐
            ├→ T-5 → T-6
T-3 → T-4 ─┘
T-7
```

Batches:
```
Batch 1: [T-1, T-3, T-7]   ← parallel, no deps
Batch 2: [T-2, T-4]         ← parallel, deps satisfied by Batch 1
Batch 3: [T-5]              ← depends on Batch 2
Batch 4: [T-6]              ← depends on Batch 3
```

## Context-Aware Batching

Each batch must fit within 70% of available context window budget to leave room for verification and error handling.

### Budget Calculation

```
available = contextWindowSize * 0.70
batchBudget = sum(task.estimatedTokens for task in batch)

if batchBudget > available:
  split batch into sub-batches that fit
```

### Splitting Oversized Batches

When a batch exceeds budget:
1. Sort tasks by `estimatedTokens` descending
2. Greedily pack into sub-batches within budget
3. Maintain dependency constraints (sub-batches at same level, no cross-deps)

## Edge Cases

### Cycles

If a cycle is detected (task A depends on B, B depends on A):
1. Report the cycle as an error
2. List the involved tasks
3. Ask for human resolution
4. Do NOT proceed with execution

### Isolated Tasks

Tasks with no dependencies AND no dependents:
- Include in Batch 1
- These can run anytime; earliest is best

### Oversized Single Tasks

A single task exceeding 70% budget:
- Flag as a candidate for breakdown
- Suggest splitting into subtasks
- If user confirms, proceed as-is but warn about context risk

### Empty Dependency References

If a task references a dependency that does not exist:
- Warn about the missing dependency
- Treat the dependency as satisfied (proceed)
- Log the inconsistency

## Visual Notation

Use this format in plans:

```
## Execution Plan

Batch 1 (parallel) ─── [T-1] [T-3] [T-7] ──── ~25k tokens
                              │        │
Batch 2 (parallel) ─── [T-2]     [T-4]    ──── ~40k tokens
                              │        │
Batch 3 (sequential) ── [T-5] ────────── ──── ~20k tokens
                              │
Batch 4 (parallel) ─── [T-6] [T-8] ────── ──── ~15k tokens

Total: ~100k tokens | Est. context windows: 2
```

## Integration with Maestro

Maestro uses batch detection to:

1. **Plan execution**: Determine which agents to spawn in parallel
2. **Manage context**: Track token budget across batches
3. **Order work**: Execute batches sequentially, tasks within batches in parallel
4. **Checkpoint**: Save state between batches for L-threads

```
for batch in batches:
  // Spawn all tasks in batch in ONE message
  parallel: [Task(implementer, task) for task in batch]
  // Wait for all to complete
  // Verify batch results
  // Checkpoint if L-thread
  // Proceed to next batch
```
