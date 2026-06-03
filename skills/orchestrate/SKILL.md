---
name: orchestrate
description: Multi-agent coordination across plan/implement/test/review; fan-out for 3+ independent workstreams. Triggers "coordinate", "orchestrate", "complex task", "parallel agents", "split work", "fan out", "multi-instance", large refactor, "overnight", "long running", "autonomous task", "extended task", "marathon", "multi-hour task".
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
4. **Sort into two piles** (the Orchestration Tax — your review attention is the serial bottleneck and it doesn't parallelize):
   - **Delegate-async** — isolated, well-specified work where your judgment lands at the *gate* (you review the finished result): scaffolding, mechanical refactors, test writing, doc generation, independent file areas. Fan these out.
   - **Hold-the-lock** — work where the judgment *is* the work: a subtle bug, an architecture decision, anything that needs your evolving mental model of the system. Parallelizing these doesn't scale output — it thrashes the one serial resource and everything comes back worse. Do them yourself, serially, one at a time.

**GO/NO-GO Verdict**:
- **GO** - 3+ *delegate-async* workstreams, clear boundaries, agents work independently. Proceed — fan out the first pile only.
- **SIMPLIFY** - <3 workstreams, OR the work is mostly *hold-the-lock* regardless of size. Delegate the isolated bits with direct Agent() calls and keep the judgment-heavy parts yourself.
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

### Alternative: dynamic workflows (research preview, v2.1.154+)

A [dynamic workflow](https://code.claude.com/docs/en/workflows) is a JS harness that spawns subagents, holds plan state *outside* your context window, runs up to 16 agents concurrently (1000 total), and resumes from cached results within a session. The trigger isn't task *size* — it's whether the task risks one of three failure modes a single context window is prone to:

- **Agentic laziness** — stopping at 20 of 50 items and declaring done. → *fan-out-and-synthesize*: one agent per item, barrier-join the results.
- **Self-preferential bias** — preferring your own output when you're also the judge. → *adversarial verification*: a separate agent refutes each finding; or a *tournament* of pairwise comparisons (more reliable than absolute scoring for ranking or taste).
- **Goal drift** — losing "don't do X" constraints across compaction. → each subagent gets a focused, isolated goal that can't drift.

Shapes worth naming when you build one: **classify-and-act**, **fan-out-and-synthesize**, **generate-and-filter**, **tournament**, **loop-until-done** (spawn until a stop condition, not a fixed count). Not only for marathons — a **quick workflow** is valid: _"quick workflow to adversarially check this one assumption."_

- **Budget** — workflows burn more tokens; cap with _"…budget 10k tokens"_ and the harness enforces it.
- **Quarantine** — for triage over untrusted input, agents that read public/untrusted content must not also take privileged actions; split reading from acting so an injected page can't trigger a privileged step.

Two entry points:
- One-shot: say _"use a workflow to …"_ or the keyword `ultracode` in your prompt (the force-keyword was renamed `workflow` → `ultracode` in v2.1.160). Pair with `/loop` for repeatable triage/verification/research.
- Session-wide: `/effort ultracode` — auto-orchestrates a workflow for every substantive task.

The maestro `Agent()` fan-out above is the **default** in cc-settings; workflows are for replayability or scale beyond subagent fan-out. Don't rewire skills to *depend* on the Workflow tool — its API is still preview-stage — but a skill may ship an *opt-in* example (see `nuclear-review`'s `references/nuclear-review.workflow.js`): a template you adapt, never a runtime dependency.

## Output

Report: team composition (when fan-out chosen), task assignments, coordination strategy, and progress.

---

## Variant: Phased Long-Running Execution

Before starting work, create a marker: `mkdir -p ~/.claude/tmp && echo "l-thread" > ~/.claude/tmp/heavy-skill-active && date -u +"%Y-%m-%dT%H:%M:%SZ" >> ~/.claude/tmp/heavy-skill-active`

For tasks too large for a single context window. Implements checkpoint/restore, automatic verification, and graceful recovery.

### When to Use

- Large refactors spanning 10+ files
- Full feature implementation with tests
- Migration tasks (dependency upgrades, API changes)
- Any task estimated at >50% context window

### Checkpoint Strategy

#### Automatic Checkpoints

Checkpoints are saved automatically at context usage thresholds. See `hooks/checkpoint.md` for actions at 70% / 80% / 90%.

#### Manual Checkpoints

Save checkpoints at these milestones:
- After completing a logical phase
- Before risky operations (schema changes, large refactors)
- After passing verification

#### Checkpoint Contents

See `hooks/checkpoint.md` for the full checkpoint JSON schema, storage location, and auto-checkpoint threshold actions.

#### Save/Restore Commands

```bash
# Save checkpoint
/checkpoint save "Completed phase 3"

# List checkpoints
/checkpoint list

# Restore from latest
/checkpoint restore
```

### Verification Stack

Every checkpoint must pass Levels 1-3 before saving. Full verification (Levels 1-5) at task completion. See `hooks/verification-check.md` for the complete 5-level stack, per-agent requirements, and failure handling.

### Workflow

#### Phase 1: Planning

```
Agent(planner, "Break down [task] into phases with dependencies and estimates")
```

Produce a phased plan with:
- Ordered phases with dependencies
- Token estimates per phase
- Checkpoint points identified
- Verification criteria per phase

#### Phase 2: Execution Loop

For each phase:

1. **Start**: Log phase start
2. **Implement**: Execute the phase work
3. **Verify**: Run verification stack
4. **Checkpoint**: Save state if milestone reached
5. **Monitor**: Check context usage, checkpoint if threshold hit

To drive this loop unattended, set a `/goal` whose condition matches the
completion promise — e.g. `/goal all phases complete, tsc + lint + tests
exit 0, git status is clean`. The goal evaluator runs after every turn and
keeps the session going until the condition holds; it survives `--resume`
so a goal set before a handoff carries into the next session.

#### Phase 3: Completion

```markdown
## Verification Summary
- [x] TypeScript compiles
- [x] Biome lint passes
- [x] Tests pass (N/N)
- [x] All phases completed

<promise>COMPLETE</promise>
```

### Recovery from Interruption

When resuming after interruption:

1. Run `checkpoint.ts restore` to load latest state
2. Check git status for uncommitted work
3. Review remaining todos
4. Run verification to confirm baseline
5. Continue from next incomplete phase

### Completion Promise

The task is NOT complete until:

```
1. All phases done
2. Verification passes (compile + lint + test)
3. Git is clean (all changes committed)
4. Summary provided with what was done
```

Only then output:

```
<promise>COMPLETE</promise>
```

**Never claim completion with failing verification.**

### Example

```
User: "Migrate all class components to hooks across the app"

→ Agent(planner, "Break migration into phases by module")
Plan: 6 phases, ~4 context windows estimated

Phase 1: Core hooks (auth, routing)
  → Implement → Verify → Checkpoint at 30%
Phase 2: Feature hooks (dashboard, settings)
  → Implement → Verify → Checkpoint at 55%
  → Context at 70% → auto-checkpoint, continue
Phase 3: Shared components
  → Context at 90% → auto-checkpoint, hand off
  [New session resumes from checkpoint]
Phase 4-6: Continue...
  → Final verification → <promise>COMPLETE</promise>
```
