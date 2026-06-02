---
name: review-batch
description: Batch-review the diffs from several agents in one sitting with per-change re-entry cards, instead of cold-reloading one agent at a time. Triggers "review batch", "review all the agents", "what's pending review", "batch review", "catch up on agent work", or after fanning out several agents.
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
   ```

   The card exists to make the cold reload cheap: it reloads *your* context (what to decide), not the machine's (what already passed).

3. **Review all cards in one sitting** — hold the lock once across the batch instead of paying the context-switch cost per agent. Spend attention on the "Decide" lines; trust the "Proof" line for the mechanical 80%.

4. **Commit what's good** — committing drains the review-queue (`review-queue-nudge`) and closes the loop. Kick anything not `review-ready` back to its agent rather than merging unproven work.

## Why batch

Reviewing 4 agents in one sitting is much cheaper than checking one, leaving, and returning cold to the next. Give agents a longer leash and let the work accumulate — but mind the tradeoff: a longer leash means staler branches, so don't let the batch grow so large that integration conflicts cost more than the context-switches you saved.
