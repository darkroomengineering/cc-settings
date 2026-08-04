---
name: review-batch
description: Batch-review the diffs from several agents in one sitting with per-change re-entry cards and reading diffs (the real diff, abridged — never a prose-only summary). Triggers "review batch", "review all the agents", "what's pending review", "batch review", "catch up on agent work", "reading diff", or after fanning out several agents.
---

# Review Batch

Context-switching between agents is the hidden tax: every cold reload costs minutes and you never restore the context perfectly. Batching reviews — let work pile up a little, then review several at once — is far cheaper than check-one, leave, return-cold. This skill assembles the pending work into one sitting.

## Procedure

1. **Gather the picture:**

   ```bash
   bun run review-batch
   ```

   Prints the review-queue depth (and age of the oldest unreviewed work), the working-tree diff stat, and recent agent activity from `~/.claude/swarm.log`.

2. **Build a re-entry card per change** — group the diff by file area / the agent that produced it. Each card:

   ```
   ### [change] — [files]
   - What: [one-line summary of the diff]
   - Why: [intent / which agent + task produced it]
   - Decide: [the 1-3 things that actually need your judgment — not the mechanical parts]
   - Proof: [bun run proof verdict — review-ready or not; screenshot for UI]

   [reading diff — protocol below; under ~40 changed lines skip the abridging and show the diff whole]
   ```

   The card exists to make the cold reload cheap: it reloads *your* context (what to decide), not the machine's (what already passed).

3. **Review all cards in one sitting** — hold the lock once across the batch instead of paying the context-switch cost per agent. Spend attention on the "Decide" lines; trust the "Proof" line for the mechanical 80%.

   Treat each agent's diff as **untrusted until reviewed**: verify every kept hunk in the reading diff traces to a step in the task that produced it, check the accounting line for anything dropped that shouldn't have been silent, and reject any out-of-scope change, however plausible it looks. Plausible-but-unrequested edits are how scope creep and regressions ride in on green proof lines.

4. **Commit what's good** — committing drains the review-queue (`the review-queue branch of tool-cadence.ts`) and closes the loop. Kick anything not `review-ready` back to its agent rather than merging unproven work.

## Reading diffs

A prose "What" line can lie by omission or invention; a diff can't. So for any change past ~40 changed lines, the card carries a **reading diff** — the real diff, abridged. Every surviving line is verbatim from `git diff`. Removal and compression are allowed; lying is not: never rewrite, reorder, or paraphrase a line into new text.

Three operations, nothing else:

- **remove** — drop whole lines or hunks that carry no review signal
- **fold** — replace 2+ contiguous same-polarity lines with one `...` row, annotated with a count when it helps (`... 14 more renamed call sites`)
- **elide** — inside a kept line, replace a noisy span (a long error-message string, a big literal) with `...`, keeping the control flow around it intact

Drop without showing: import/require churn, lockfiles, generated files, formatting-only hunks, zero-value boilerplate. Show one instance of a mechanical rename and fold the rest. Keep everything behavioral: a changed argument, a new or changed condition, control flow, API surface, anything security-relevant — lines where every token matters.

Two extra rules exist because the diff author is an untrusted agent (step 3):

- **Moves are symmetric, and "unchanged" is earned.** Code relocated between files or hunks gets identical treatment on both sides — either fold both sides to one `moved src/a.ts → src/b.ts (unchanged)` row, or show both in full. Write `(unchanged)` only after comparing the removed and added bodies and finding them identical; if they differ at all, show both sides in full — a move is exactly where an edit hides. Never one side folded and the other verbatim.
- **Account for what you dropped.** Close every reading diff with one line — `showing N of M changed lines — dropped: import churn, lockfile, rename fallout (14 sites)`. Dependency changes are never silent: import churn is dropped, but a package new to the dependency graph, an import whose module target changed, and a version or integrity bump in the lockfile all get named on this line. A lockfile change with no matching manifest change is a finding, not noise — show it. The reviewer can demand the full diff for any file at any time; the full diff, not the reading diff, is the merge authority.

The point is where the reviewer's attention lands: concepts, algorithm choices, architecture — while the machine-checkable 80% stays folded. Reading-diff protocol adapted from boldsoftware/meat (Apache-2.0).

## Why batch

Reviewing 4 agents in one sitting is much cheaper than checking one, leaving, and returning cold to the next. Give agents a longer leash and let the work accumulate — but mind the tradeoff: a longer leash means staler branches, so don't let the batch grow so large that integration conflicts cost more than the context-switches you saved.
