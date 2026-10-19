---
name: orchestrate
description: Coordinate agents across plan, implement, test, and review, or fan out 3+ independent workstreams. Triggers "orchestrate", "parallel agents", "fan out", "split work", "overnight", "autonomous task".
context: fork
agent: maestro
---

# Multi-Agent Orchestration

## Standalone Codex

Create each bounded worker
with `spawn_agent`, deliver context to a running worker with `send_message`,
trigger another turn for an idle existing worker with `followup_task`, wait with
`wait_agent`, and stop a current turn with `interrupt_agent` only when necessary.
Never spawn `codex-verifier` or call `codex-run.ts`.

Read the live concurrency limit and stay within it. Writers share the working
tree unless the live host explicitly offers isolation. Assign non-overlapping
ownership and serialize implementer and test-writer phases; only read-only
reviewers may overlap. Codex implementers are not promised Claude worktree
isolation. The lead owns every git operation: subagents never commit, stash,
switch branches, or touch worktrees; they leave changes in place and report
them, and the lead stages, verifies, and commits once per territory.

## Phase 1: Research & Feasibility (GO/NO-GO Gate)

Before delegating to agents:

1. **Parse requirements** - Break down what needs to happen
2. **Identify workstreams** - Which are independent? Which have dependencies?
3. **Assess scope** - Is this actually multi-agent work, or simpler than it looks?
4. **Sort into two piles** (maestro principle 3): *delegate-async* work (isolated, well-specified) fans out; *hold-the-lock* work (the judgment is the work) stays with you, serially.

**GO/NO-GO Verdict**:
- **GO** - 3+ *delegate-async* workstreams, clear boundaries, agents work independently. Proceed — fan out the first pile only.
- **SIMPLIFY** - <3 workstreams, OR the work is mostly *hold-the-lock* regardless of size. Delegate the isolated bits with direct Agent() calls and keep the judgment-heavy parts yourself.
- **NO-GO** - Requirements unclear, scope too large, or high risk of file conflicts. Report and stop.

Do not proceed past this gate without an explicit verdict.

## Phase 2: Orchestrate

This skill runs as the maestro agent: select agents, run them in parallel, and coordinate per `agents/maestro.md`. For simple delegation (1-2 agents), call `Agent()` directly without this skill.

## Verify Subagent Claims Independently

A subagent's "done" is a claim, not a result. Before building on it, committing,
or reporting success:

1. **Re-run the briefed verification yourself** against the real artifact —
   the actual build, the actual binary's output, the actual grep sweep. Never
   forward a subagent's self-reported pass as your own verification.
2. **Check the capability envelope.** Subagents may lack tools you assume
   (a no-Bash implementer cannot run builds or delete files — it will
   improvise, e.g. zeroing a file instead of removing it, and still report
   done). Read what the agent *says it couldn't do*, then absorb the gap
   yourself: run the deletion, the build, the test.
3. **Re-delegate vs fix solo.** A trivial break found during verification
   (single file, few lines) — fix it solo with a one-line stated reason;
   round-tripping to a fresh subagent costs more than the fix. Anything that
   adds scope goes back out as a new, fully-briefed delegation. A
   `scope_expansion` status from an implementer is reviewed against its listed
   paths before anything lands.
4. **Resume, don't respawn.** If a subagent's report was cut off or is
   missing a section, Claude uses SendMessage; standalone Codex uses
   `send_message` while it is running or `followup_task` once idle. A respawn
   rebuilds its context from nothing and re-does paid work.

Failure mode this section exists to prevent: chaining on an unverified "done"
and discovering three phases later that the build never ran.

## Standalone Codex orchestration

Follow the native lifecycle at the top of this skill: use `spawn_agent` for each new bounded workstream, queue dependent work instead of exceeding the live concurrency limit, and never invoke the Claude-to-Codex bridge. Claude agent teams and dynamic workflows are Claude-only; do not emulate their APIs in Codex.

## When to Fan Out (Teams mode)

Use full parallel team fan-out instead of sequential subagent delegation when:

| Scenario | Fan out? | Why |
|----------|----------|-----|
| 3+ independent file areas | Yes | Maximum parallelism, isolated context per agent |
| Frontend + Backend + Tests | Yes | No file conflicts, clear boundaries |
| Large codebase analysis | Yes | Independent context per agent prevents bleed |
| Competing approaches | Yes | Explore alternatives in parallel before deciding |
| Sequential dependent work | No | Use subagents in sequence; fan-out adds overhead |
| Quick single investigation | No | Overhead not worth it; spawn the `explore` agent directly |

### Prerequisites for fan-out

Two different mechanisms get confused here, so be explicit about which one you want:

- **Subagent fan-out** (`Agent` calls in one message) needs **nothing enabled**. This is what cc-settings actually uses, and what the rest of this skill assumes. Each subagent gets its own context window and reports back to you.
- **Agent teams** (teammates that message each other and share a task list) are available but not automatic. Pick a team over plain fan-out only when workers must challenge each other mid-flight; to collect N results, fan-out is cheaper. Rules and feasibility gates: `CLAUDE-FULL.md` → "Agent teams". For split panes, `config/10-core.json` pins `teammateMode: "auto"` (tmux, or iTerm2 with the `it2` CLI).

### Alternative: dynamic workflows (research preview)

A [dynamic workflow](https://code.claude.com/docs/en/workflows) is a JS harness that spawns subagents, holds plan state *outside* your context window, runs up to 16 agents concurrently (1000 total; raise the concurrency cap with `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`, 1–256, since v2.1.269), and resumes from cached results within a session. The trigger isn't task *size* — it's whether the task risks one of three failure modes a single context window is prone to:

- **Agentic laziness** — stopping at 20 of 50 items and declaring done. → *fan-out-and-synthesize*: one agent per item, barrier-join the results.
- **Self-preferential bias** — preferring your own output when you're also the judge. → *adversarial verification*: a separate agent refutes each finding; or a *tournament* of pairwise comparisons (more reliable than absolute scoring for ranking or taste).
- **Goal drift** — losing "don't do X" constraints across compaction. → each subagent gets a focused, isolated goal that can't drift.

Shapes worth naming when you build one: **classify-and-act**, **fan-out-and-synthesize**, **generate-and-filter**, **tournament**, **loop-until-done** (spawn until a stop condition, not a fixed count). Not only for marathons — a **quick workflow** is valid: _"quick workflow to adversarially check this one assumption."_

- **Budget** — workflows burn more tokens; cap with _"…budget 10k tokens"_ and the harness enforces it.
- **Size** — dynamic workflows default to a medium size guideline, aiming for fewer than 10 agents (Pro plans default to small); the running workflow's status line shows the current default. Override per-project via the `workflowSizeGuideline` settings key when a task genuinely needs more.
- **Quarantine** — for triage over untrusted input, agents that read public/untrusted content must not also take privileged actions; split reading from acting so an injected page can't trigger a privileged step.

Two entry points:
- One-shot: say _"use a workflow to …"_ or the keyword `ultracode` in your prompt. Pair with `/loop` for repeatable triage/verification/research.
- Session-wide: `/effort ultracode` — auto-orchestrates a workflow for every substantive task.

The maestro `Agent()` fan-out above is the **default** in cc-settings; workflows are for replayability or scale beyond subagent fan-out. Don't rewire skills to *depend* on the Workflow tool — its API is still preview-stage — but a skill may ship an *opt-in* example (see `audit`'s `references/nuclear-review.workflow.js`): a template you adapt, never a runtime dependency.

## Output

Report: team composition (when fan-out chosen), task assignments, coordination strategy, and progress.

---

## Variant: Phased Long-Running Execution

For tasks too large for a single context window. Implements git-commit checkpoints, automatic verification, and graceful recovery.

### When to Use

- Large refactors spanning 10+ files
- Full feature implementation with tests
- Migration tasks (dependency upgrades, API changes)
- Any task estimated at >50% context window

### Checkpoint Strategy

#### Context-Threshold Checkpoints

No hook saves state automatically — the agent must commit and write a handoff
itself when it notices context usage crossing a threshold. At 70% commit
finished work and log a progress summary; at 80% compact or run `/handoff`; at
90% stop, commit, and run `/handoff` (the usage table is in the `handoff` skill).

#### Manual Checkpoints

A checkpoint is a git commit of verified work. Commit at these milestones:
- After completing a logical phase
- Before risky operations (schema changes, large refactors)
- After passing verification

#### Maintenance Checkpoints

A completed phase is a **commit checkpoint, not a stopping point** — the job is the whole plan, not the first green milestone; finishing a phase means starting the next, and you only hand back to the user on a genuine blocker. On long runs, spend one pass every few phases on maintenance before drift accumulates: prune plan bloat (tasks that no longer match what the code taught you), refresh the live handoff so a cold resume lands cleanly, delete dead TODOs, and reconcile the plan with the current architecture rather than preserving development-only shims the plan predates.

Stamp the plan with the commit it was written against (`git rev-parse --short HEAD`) and re-stamp on every maintenance pass. The reconcile semantics: re-run the done-criteria of tasks marked complete (a "done" that no longer verifies gets reopened, not trusted), refresh file/line refs that drifted since the stamp, and retire tasks obsoleted by intervening changes with a one-line reason so they aren't re-litigated later.

#### Rolling Back

To undo a bad phase, use Claude Code's built-in `/rewind` (conversation and file state), or `git reset --soft <checkpoint-commit>` to the last good commit. `/handoff` carries the plan, decisions, and remaining todos into a new session.

### Verification Stack

Every checkpoint commit must pass Levels 1-3 first. Full verification (Levels 1-5) at task completion. See `hooks/verification-check.md` for the complete 5-level stack, per-agent requirements, and failure handling.

### Workflow

#### Phase 1: Planning

```
Agent(planner, "Break down [task] into phases with dependencies and estimates")
```

Produce a phased plan with:
- A `## Functional DAG` up top (`docs/functional-dag.md`) — the fan-out piles are its
  columns, so the parallelizable set is read off the diagram instead of guessed
- Ordered phases with dependencies
- Token estimates per phase
- Checkpoint points identified
- Verification criteria per phase

#### Phase 2: Execution Loop

For each phase:

1. **Start**: Log phase start
2. **Implement**: Execute the phase work
3. **Verify**: Run verification stack
4. **Checkpoint**: Commit verified work if a milestone was reached
5. **Monitor**: Check context usage, commit and hand off if a threshold is hit

To drive this loop unattended, set a `/goal` whose condition matches the
completion promise — e.g. `/goal all phases complete, tsc + lint + tests
exit 0, git status is clean`. The goal evaluator runs after every turn and
keeps the session going until the condition holds; it survives `--resume`
so a goal set before a handoff carries into the next session.

#### Phase 3: Completion

End with the Completion Promise below.

### Recovery from Interruption

When resuming after interruption:

1. Run `/handoff resume` to load the latest handoff, if one was saved
2. Check git status and `git log` for the last checkpoint commit and uncommitted work
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
