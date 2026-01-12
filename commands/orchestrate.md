---
name: orchestrate
description: Invoke Maestro orchestrator for complex multi-agent tasks
arguments:
  - name: task
    description: The complex task to orchestrate
    required: true
---

**Usage:** `/orchestrate <task description>`

**Examples:**
- `/orchestrate implement user authentication with OAuth`
- `/orchestrate refactor Button component and update all usages`
- `/orchestrate add dark mode support across the app`
- `/orchestrate debug and fix the checkout flow`

**Behavior:**

1. **Task Analysis**
   ```
   - Assess complexity
   - Identify required agents
   - Map dependencies
   ```

2. **Planning Phase**
   ```
   - Delegate to planner for breakdown
   - Identify parallelizable work
   - Create execution timeline
   ```

3. **Execution Phase**
   ```
   - Spawn agents for sub-tasks
   - Run parallel where possible
   - Monitor progress
   - Handle failures
   ```

4. **Synthesis Phase**
   ```
   - Combine results
   - Verify completeness
   - Run final checks
   ```

**Output Format:**

```markdown
## Orchestration: [Task]

### Plan
1. [Step 1] → Agent: [agent]
2. [Step 2] → Agent: [agent]
   ↳ Parallel with Step 3
3. [Step 3] → Agent: [agent]

### Progress
████████░░ 80%

### Active
- [→] implementer: Creating component

### Completed
- [✓] planner: Task breakdown
- [✓] scaffolder: File structure

### Next
- [ ] reviewer: Final review

### Blockers
None
```

**Agents Used:**
- `maestro` (coordinator)
- `planner` (breakdown)
- `implementer` (code)
- `reviewer` (quality)
- `tester` (verification)
- Others as needed

**Best For:**
- Multi-file changes
- Cross-cutting features
- Complex debugging
- Major refactoring
