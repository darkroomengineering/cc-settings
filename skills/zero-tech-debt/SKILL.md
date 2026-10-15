---
name: zero-tech-debt
description: Rewrite an accreted patch into its intended end state by removing unused compat layers, flags, fallbacks, and wrappers. Triggers "zero tech debt", "delete the compat layer", "kill the legacy path", "too many flags".
context: main
---

# Zero Tech Debt

Rework the change from the intended end-state, not from the historical path that produced the current patch. The principles (no compat hacks, no abstractions you don't need, no dead branches) are in `AGENTS.md` — this skill is the workflow for applying them to a specific patch.

## When to invoke

- A feature has accreted mode props, route aliases, or fallbacks across iterations
- A migration left behind a compatibility shim that no current caller uses
- You catch yourself preserving an old shape "just in case" with no concrete caller in mind
- The diff is bigger than the change it represents because it's making the old structure better instead of removing it

For restructuring code outside the current diff use `/refactor`. This skill is for the patch in front of you. The native `/code-review` reports correctness issues; it does not tighten code.

## Steps

1. **State the intended end-state.** One or two sentences. If you can't name it, stop and ask the user — you'll otherwise optimize toward the current shape.
2. **Search for real callers before preserving compatibility.** For each mode prop, route alias, fallback branch, or wrapper: grep for current callers. No caller → delete it, don't improve it.
3. **Reshape around the final product surface.** Prefer one clear component or flow over mode flags. Split only when there's an obvious boundary — state, layout, controls, or domain commands.
4. **Move shared rules to one place.** Feature flags, permissions, route gating, URL state, and command naming should not be duplicated across pages or hidden inside view components.
5. **Verify the intended flow.** Test the new behavior and any deleted assumptions that affect navigation, permissions, or persisted state. Apply the `deslopper` test-value rubric to tests the patch orphans or duplicates before deleting any.

## Rules

- Scope the rework to what makes the final shape coherent; leave unrelated cleanup alone.
- Name things for product intent, not implementation history (`AdminDashboard` over `LegacyDashboardV2`).
