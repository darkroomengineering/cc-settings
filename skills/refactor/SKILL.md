---
name: refactor
description: Behavior-preserving restructuring of code NOT in your current diff — extract modules, rename across files, pay down tech debt. For just-changed code use /zero-tech-debt. Triggers "refactor X", "restructure", "extract Y from Z".
context: fork
---

# Refactoring Workflow

## Standalone Codex

Create each new agent with `spawn_agent`, deliver
context to a running agent with `send_message`, trigger another turn for an idle
existing agent with `followup_task`, wait with `wait_agent`, and stop a current
turn with `interrupt_agent` only when necessary. Never spawn `codex-verifier`
and never run `codex-run.ts` from inside Codex.

Writers share the working tree unless the live host explicitly offers
isolation. Assign non-overlapping ownership and serialize planner handoff,
implementer, and test-writer phases; only read-only reviewers may overlap.
Codex implementers are not promised Claude worktree isolation.

You are in **Maestro orchestration mode**. Delegate immediately.

## Workflow

1. **Explore** - Spawn `explore` agent to analyze current code
2. **Plan** - Spawn `planner` agent to design refactoring approach
3. **Implement** - Spawn `implementer` agent to refactor
4. **Test** - Spawn `tester` agent to verify behavior unchanged
5. **Review** - Spawn `reviewer` agent to check quality
6. **Learn** - Store patterns discovered during refactoring

## Agent Delegation

Spawn explore and planner first — they accept thin prompts because they
discover what they need from the codebase:

```
Agent(explore, "Analyze the code to refactor: $ARGUMENTS. Identify patterns, issues, dependencies.")
Agent(planner, "Design refactoring approach based on analysis. Keep behavior unchanged.")
```

**Claude: then assemble the implementer prompt from the actual planner output.**
The Claude implementer runs in an isolated worktree with no access to prior agent
results, so paste the real plan — not "according to plan":

- The user's refactor target (`$ARGUMENTS`) verbatim
- The planner's step-by-step plan, including file paths and each move/rename/extract operation
- Any "preserve behavior" invariants the planner called out
- The test command that must remain green
- Scope: "only the files in the plan; do not touch anything else"

Now spawn:

```
Agent(implementer, "<the assembled briefing above — all five items inline>")
Agent(tester, "Verify refactored code behaves identically to original.")
Agent(reviewer, "Review refactoring for quality and completeness.")
```

**Standalone Codex branch:** follow the lifecycle and serialization rules at
the top. Use a fresh read-only `reviewer` for the independent pass after the
writer and tester finish. Skip the Claude bridge branch below.

Refactors are a top source of subtle regressions — behavior that "shouldn't change" quietly does. When the Codex bridge is available, run a cross-model review in parallel with the reviewer:

```
Agent(codex-verifier, "Cross-model review of the refactor diff. Confirm behavior is preserved; report findings by severity.")
```

The bridge is gated and fails open: if Codex is unavailable, the reviewer agent alone is fine.

If the `codex-verifier` spawn fails, or it reports that Bash was stripped (forked skill contexts), run `bun "$HOME/.claude/src/scripts/codex-run.ts" review` directly instead — never skip the cross-model pass.

## Output

Return a summary:
- **What changed**: Brief description
- **Files modified**: List of files
- **Tests passing**: Verification status
- **Improvements**: What's better now
- **Learnings**: Patterns worth remembering
