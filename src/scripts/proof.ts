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
// Projects can opt into extra ADVISORY probes by depending on the tool:
// react-doctor (React render/quality) and deslop (framework-agnostic cross-file
// dead code). They report a signal but never flip the verdict.

import {
  allGreen,
  detectDeslop,
  detectGates,
  detectReactDoctor,
  formatReport,
  runDeslop,
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
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const hasReactDoctor = detectReactDoctor(deps);
const hasDeslop = detectDeslop(deps);

const advisoryLabels = [
  ...(hasReactDoctor ? ["react-doctor (advisory)"] : []),
  ...(hasDeslop ? ["deslop (advisory)"] : []),
];

if (gates.length === 0 && advisoryLabels.length === 0) {
  console.log("Proof of work: no verify scripts (typecheck/test/lint) in package.json — skipping.");
  process.exit(0);
}

console.log(`Running proof-of-work gates: ${[...gates, ...advisoryLabels].join(", ")} …\n`);
const cwd = process.cwd();
const results = await runGates(gates, cwd);
if (hasReactDoctor) results.push(await runReactDoctor(cwd));
if (hasDeslop) results.push(await runDeslop(cwd));
console.log(formatReport(results));
process.exit(allGreen(results) ? 0 : 1);
