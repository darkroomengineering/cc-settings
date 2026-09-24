#!/usr/bin/env bun
// Runs the `claude plugin eval` cases for skills changed since the upstream
// branch, so a skill edit is checked against its own eval before it ships.
// Cases live in evals/<skill>-<slug>/ and select a skill with `tags: [<skill>]`.
//
// Usage: bun src/scripts/eval-changed.ts [--base <ref>] [--max-cost-usd <n>]
// Exit 0: nothing changed, every case passed, or the run could not finish
// (missing CLI, auth, cost ceiling), which warns instead of blocking.
// Exit 1: a changed skill has no case, or a case scored below the threshold.

import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evalCaseTags } from "../lib/lint-skills.ts";

const ROOT = join(import.meta.dir, "..", "..");
const MODEL = "claude-sonnet-5";
const JUDGE_MODEL = "claude-haiku-4-5-20251001";
const THRESHOLD = "0.8";

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

function git(args: string[]): string | null {
  const proc = Bun.spawnSync({ cmd: ["git", ...args], cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  return proc.exitCode === 0 ? new TextDecoder().decode(proc.stdout).trim() : null;
}

function skillNames(): Set<string> {
  const dir = join(ROOT, "skills");
  return new Set(
    readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name),
  );
}

const base = flag("--base", git(["rev-parse", "--abbrev-ref", "@{u}"]) ?? "origin/main");
const diff = git(["diff", "--name-only", `${base}...HEAD`]);
if (diff === null) {
  console.error(`[eval-changed] cannot diff against ${base}; skipping skill evals.`);
  process.exit(0);
}

const skills = skillNames();
const cases = new Map(evalCaseTags(join(ROOT, "evals")));
const changed = new Set<string>();
for (const file of diff.split("\n")) {
  const [top, name] = file.split("/");
  if (top === "skills" && name && skills.has(name)) changed.add(name);
  if (top === "evals" && name) {
    for (const tag of cases.get(name) ?? []) if (skills.has(tag)) changed.add(tag);
  }
}
if (changed.size === 0) process.exit(0);

const covered = new Set([...cases.values()].flat());
const missing = [...changed].filter((s) => !covered.has(s)).sort();
if (missing.length > 0) {
  console.error(
    `[eval-changed] changed skills with no eval case: ${missing.join(", ")}\n` +
      "Add evals/<skill>-<slug>/prompt.md with `tags: [<skill>]` and a grader.",
  );
  process.exit(1);
}

if (!Bun.which("claude")) {
  console.error("[eval-changed] claude CLI not found; skipping skill evals.");
  process.exit(0);
}

const targets = [...changed].sort();
const out = join(tmpdir(), `cc-settings-eval-${process.pid}.json`);
console.error(`[eval-changed] running evals for: ${targets.join(", ")}`);
const proc = Bun.spawnSync({
  cmd: [
    "claude",
    "plugin",
    "eval",
    ROOT,
    ...targets.flatMap((t) => ["--tag", t]),
    "--runs",
    "1",
    // Parallel runs share scaffold state and let cases see the plugin checkout.
    "-j",
    "1",
    "--ablation",
    "none",
    "--trust-plugin",
    // The cases and their fixture scripts are this repo's own files, so the
    // scaffold and write grants cover code we already review in the diff.
    "--scaffold",
    "--allow-tools",
    "Write",
    "Edit",
    "Bash",
    "--no-publish",
    "--model",
    MODEL,
    "--judge-model",
    JUDGE_MODEL,
    "--threshold",
    THRESHOLD,
    "--max-cost-usd",
    flag("--max-cost-usd", "5"),
    "--json",
    out,
  ],
  cwd: ROOT,
  stdout: "pipe",
  stderr: "pipe",
});

interface EvalReport {
  partial?: boolean;
  partialReason?: string;
  costUsd?: number;
  cases?: { name: string; aggregates?: { score?: number } }[];
}
let report: EvalReport = {};
try {
  report = JSON.parse(readFileSync(out, "utf8")) as EvalReport;
} catch {
  // No report: the CLI failed before writing one. Handled by the exit code below.
}

for (const c of report.cases ?? []) {
  const score = c.aggregates?.score ?? 0;
  console.error(`  ${score >= Number(THRESHOLD) ? "pass" : "FAIL"} ${score.toFixed(2)}  ${c.name}`);
}
if (report.costUsd !== undefined) console.error(`  cost $${report.costUsd.toFixed(2)}`);

if (proc.exitCode === 0) process.exit(0);
if (proc.exitCode === 2 || report.partial) {
  console.error(
    `[eval-changed] eval run incomplete (${report.partialReason ?? "partial"}); not blocking.`,
  );
  process.exit(0);
}
if (!report.cases) {
  const err = new TextDecoder().decode(proc.stderr).trim().split("\n").slice(-5).join("\n");
  console.error(`[eval-changed] eval could not run; not blocking.\n${err}`);
  process.exit(0);
}
console.error(`[eval-changed] a changed skill scored below ${THRESHOLD}.`);
process.exit(1);
