#!/usr/bin/env bun
// `bun run review-batch` — assemble the pending-review picture in one place so
// you can batch-review instead of cold-reloading one agent at a time (the
// context-switch tax from the "Orchestration Tax"). Prints the review-queue
// depth + age, the working-tree diff stat, and the agents that ran recently
// (from ~/.claude/swarm.log). The /review-batch skill turns this into per-change
// re-entry cards. Fail-soft: missing git/log just yields empty sections.

import { runGit } from "../lib/git.ts";
import { readState } from "../lib/hook-runtime.ts";
import { claudePath } from "../lib/platform.ts";
import { ageMs, formatAge, type ReviewQueueState } from "../lib/review-queue.ts";

const rq = await readState<ReviewQueueState>("review-queue.json", { awaiting: 0 });
const [unstaged, staged] = await Promise.all([
  runGit(["diff", "--stat"]),
  runGit(["diff", "--cached", "--stat"]),
]);

let swarmTail = "";
try {
  const log = await Bun.file(claudePath("swarm.log")).text();
  swarmTail = log.trimEnd().split("\n").slice(-12).join("\n");
} catch {
  // no swarm log yet — fine
}

const age = ageMs(rq, Date.now());
const lines: string[] = [
  "=== Review batch ===",
  `Review queue: ${rq.awaiting} unreviewed${age > 0 ? ` (oldest ${formatAge(age)})` : ""}`,
  "",
  "Working tree (unstaged):",
  unstaged || "  (clean)",
];
if (staged) lines.push("", "Staged:", staged);
if (swarmTail) lines.push("", "Recent agent activity (~/.claude/swarm.log tail):", swarmTail);
lines.push(
  "",
  "Next: one re-entry card per change, run `bun run proof`, review in a single",
  "sitting, then commit what's review-ready (commit drains the queue).",
);
console.log(lines.join("\n"));
