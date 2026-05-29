#!/usr/bin/env bun
// `bun run proof` — the proof-of-work gate. Runs the project's verification
// battery (typecheck/test/lint detected from package.json) and prints a single
// review-ready verdict. Exit 0 = review-ready, exit 1 = a gate failed.
//
// The point (see src/lib/proof-of-work.ts): an agent's diff shouldn't reach a
// human reviewer until the machine-verifiable checks are green — that keeps the
// scarce serial resource (human attention) on judgment, not on confirming what
// a machine could.

import { detectGates, formatReport, runGates } from "../lib/proof-of-work.ts";

const pkg = (await Bun.file("package.json")
  .json()
  .catch(() => ({}))) as { scripts?: Record<string, string> };
const gates = detectGates(pkg.scripts ?? {});

if (gates.length === 0) {
  console.log("Proof of work: no verify scripts (typecheck/test/lint) in package.json — skipping.");
  process.exit(0);
}

console.log(`Running proof-of-work gates: ${gates.join(", ")} …\n`);
const results = await runGates(gates, process.cwd());
console.log(formatReport(results));
process.exit(results.every((r) => r.status !== "fail") ? 0 : 1);
