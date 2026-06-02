#!/usr/bin/env bun
// `bun run proof` — the proof-of-work gate. Runs the project's verification
// battery (typecheck/test/lint detected from package.json) and prints a single
// review-ready verdict. Exit 0 = review-ready, exit 1 = a gate failed.
//
// The point (see src/lib/proof-of-work.ts): an agent's diff shouldn't reach a
// human reviewer until the machine-verifiable checks are green — that keeps the
// scarce serial resource (human attention) on judgment, not on confirming what
// a machine could.
//
// For React projects that depend on react-doctor, an extra ADVISORY probe runs
// its deterministic scan. It reports a score but never flips the verdict.

import {
  allGreen,
  detectGates,
  detectReactDoctor,
  formatReport,
  runGates,
  runReactDoctor,
} from "../lib/proof-of-work.ts";

const pkg = (await Bun.file("package.json")
  .json()
  .catch(() => ({}))) as {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const gates = detectGates(pkg.scripts ?? {});
const hasReactDoctor = detectReactDoctor({ ...pkg.dependencies, ...pkg.devDependencies });

if (gates.length === 0 && !hasReactDoctor) {
  console.log("Proof of work: no verify scripts (typecheck/test/lint) in package.json — skipping.");
  process.exit(0);
}

const labels = [...gates, ...(hasReactDoctor ? ["react-doctor (advisory)"] : [])];
console.log(`Running proof-of-work gates: ${labels.join(", ")} …\n`);
const results = await runGates(gates, process.cwd());
if (hasReactDoctor) results.push(await runReactDoctor(process.cwd()));
console.log(formatReport(results));
process.exit(allGreen(results) ? 0 : 1);
