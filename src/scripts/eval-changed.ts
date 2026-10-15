#!/usr/bin/env bun
// Runs the `claude plugin eval` cases for skills changed since the upstream
// branch, so a skill edit is checked against its own eval before it ships.
// Cases live in evals/<skill>-<slug>/ and select a skill with `tags: [<skill>]`.
//
// Usage: bun src/scripts/eval-changed.ts [--base <ref>] [--max-cost-usd <n>] [--base-arm]
// --base-arm also runs the cases against the version of each changed skill at
// the merge-base with <ref>, then labels every case improvement, regression,
// no-regression-only, or still-failing. The cost ceiling covers both arms.
// Exit 0: nothing changed, every case passed, or the run could not finish
// (missing CLI, auth, cost ceiling), which warns instead of blocking.
// Exit 1: a changed skill has no case, or a case scored below the threshold.
// Only the current version gates; the base arm adds labels.

import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evalCaseTags } from "../lib/lint-skills.ts";

const ROOT = join(import.meta.dir, "..", "..");
const MODEL = "claude-sonnet-5-5";
const JUDGE_MODEL = "claude-haiku-4-5-20251001";
const THRESHOLD = "0.8";

export const HELP = `Usage: bun src/scripts/eval-changed.ts [--base <ref>] [--max-cost-usd <n>] [--base-arm]

  --base <ref>         diff against <ref> (default: upstream branch, else origin/main)
  --max-cost-usd <n>   cost ceiling in USD (default 5); with --base-arm it covers both arms
  --base-arm           also run each changed skill's cases against its merge-base version
                       and label every case: improvement, regression, no-regression-only,
                       or still-failing
  -h, --help           show this text`;

export type ArmOutcome = "improvement" | "regression" | "no-regression-only" | "still-failing";

export function flag(name: string, fallback: string, argv: string[] = process.argv): string {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : fallback;
}

export function classifyArms(oldScore: number, newScore: number, threshold: number): ArmOutcome {
  const oldPass = oldScore >= threshold;
  const newPass = newScore >= threshold;
  if (oldPass && newPass) return "no-regression-only";
  if (!oldPass && newPass) return "improvement";
  if (oldPass && !newPass) return "regression";
  return "still-failing";
}

export function splitCost(total: string, arms: number): string {
  return String(Number(total) / arms);
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

interface EvalReport {
  partial?: boolean;
  partialReason?: string;
  costUsd?: number;
  cases?: { name: string; aggregates?: { score?: number } }[];
}

interface Arm {
  exitCode: number | null;
  stderr: string;
  report: EvalReport;
}

function runArm(plugin: string, targets: string[], maxCost: string, label: string): Arm {
  const out = join(tmpdir(), `cc-settings-eval-${label}-${process.pid}.json`);
  const proc = Bun.spawnSync({
    cmd: [
      "claude",
      "plugin",
      "eval",
      plugin,
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
      maxCost,
      "--json",
      out,
    ],
    cwd: plugin,
    stdout: "pipe",
    stderr: "pipe",
  });
  let report: EvalReport = {};
  try {
    report = JSON.parse(readFileSync(out, "utf8")) as EvalReport;
  } catch {
    // No report: the CLI failed before writing one. Handled by the exit code.
  }
  return { exitCode: proc.exitCode, stderr: new TextDecoder().decode(proc.stderr), report };
}

// A throwaway plugin that mirrors ROOT except `skills/`, where each skill in
// `swap` is replaced by its version at `mergeBase`. `evals/` is copied from the
// working tree so both arms run the same cases (the runner refuses a symlinked
// evals dir). Skills absent at the merge-base are returned in `added`.
function buildBasePlugin(mergeBase: string, swap: string[]): { dir: string; added: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "cc-settings-eval-base-"));
  for (const entry of readdirSync(ROOT)) {
    if (entry === ".git" || entry === "skills" || entry === "evals") continue;
    symlinkSync(join(ROOT, entry), join(dir, entry));
  }
  cpSync(join(ROOT, "skills"), join(dir, "skills"), { recursive: true });
  cpSync(join(ROOT, "evals"), join(dir, "evals"), {
    recursive: true,
    filter: (src) => !src.startsWith(join(ROOT, "evals", "results")),
  });
  const added: string[] = [];
  for (const name of swap) {
    const archive = Bun.spawnSync({
      cmd: ["git", "archive", "--format=tar", mergeBase, `skills/${name}`],
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (archive.exitCode !== 0) {
      added.push(name);
      continue;
    }
    rmSync(join(dir, "skills", name), { recursive: true, force: true });
    const untar = Bun.spawnSync({
      cmd: ["tar", "-x", "-C", dir],
      stdin: archive.stdout,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (untar.exitCode !== 0) {
      throw new Error(`could not extract skills/${name} from ${mergeBase}`);
    }
  }
  return { dir, added };
}

function scores(report: EvalReport): Map<string, number> {
  return new Map((report.cases ?? []).map((c) => [c.name, c.aggregates?.score ?? 0]));
}

function reportBaseArm(oldArm: Arm, newArm: Arm): void {
  const before = scores(oldArm.report);
  const tally: Record<ArmOutcome, number> = {
    improvement: 0,
    regression: 0,
    "no-regression-only": 0,
    "still-failing": 0,
  };
  console.error("  old -> new  outcome");
  for (const [name, now] of scores(newArm.report)) {
    const was = before.get(name);
    if (was === undefined) {
      console.error(`  --  -> ${now.toFixed(2)}  no base score  ${name}`);
      continue;
    }
    const outcome = classifyArms(was, now, Number(THRESHOLD));
    tally[outcome]++;
    console.error(`  ${was.toFixed(2)} -> ${now.toFixed(2)}  ${outcome}  ${name}`);
  }
  console.error(
    `  delta: ${tally.improvement} improvement, ${tally.regression} regression, ` +
      `${tally["no-regression-only"]} no-regression-only, ${tally["still-failing"]} still-failing`,
  );
  if (tally.improvement === 0 && tally.regression === 0) {
    console.error(
      "  no case separates old from new: this run shows no regression, not improvement.",
    );
  }
}

function main(): never {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
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
  const wantsBaseArm = process.argv.includes("--base-arm");
  const mergeBase = wantsBaseArm ? git(["merge-base", base, "HEAD"]) : null;
  if (wantsBaseArm && mergeBase === null) {
    console.error(`[eval-changed] no merge-base with ${base}; running without --base-arm.`);
  }
  const totalCost = flag("--max-cost-usd", "5");
  const armCost = mergeBase !== null ? splitCost(totalCost, 2) : totalCost;

  console.error(`[eval-changed] running evals for: ${targets.join(", ")}`);
  const current = runArm(ROOT, targets, armCost, "current");

  for (const c of current.report.cases ?? []) {
    const score = c.aggregates?.score ?? 0;
    console.error(
      `  ${score >= Number(THRESHOLD) ? "pass" : "FAIL"} ${score.toFixed(2)}  ${c.name}`,
    );
  }
  let cost = current.report.costUsd;

  if (mergeBase !== null) {
    const { dir, added } = buildBasePlugin(mergeBase, targets);
    try {
      const baseTargets = targets.filter((t) => !added.includes(t));
      if (added.length > 0) {
        console.error(`[eval-changed] no base version for new skill(s): ${added.join(", ")}`);
      }
      if (baseTargets.length > 0) {
        console.error(
          `[eval-changed] base arm at ${mergeBase.slice(0, 9)} for: ${baseTargets.join(", ")}`,
        );
        const old = runArm(dir, baseTargets, armCost, "base");
        if (old.report.cases) reportBaseArm(old, current);
        else {
          const err = old.stderr.trim().split("\n").slice(-5).join("\n");
          console.error(`[eval-changed] base arm could not run; no comparison.\n${err}`);
        }
        if (old.report.costUsd !== undefined) cost = (cost ?? 0) + old.report.costUsd;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (cost !== undefined) console.error(`  cost $${cost.toFixed(2)}`);

  if (current.exitCode === 0) process.exit(0);
  if (current.exitCode === 2 || current.report.partial) {
    console.error(
      `[eval-changed] eval run incomplete (${current.report.partialReason ?? "partial"}); not blocking.`,
    );
    process.exit(0);
  }
  if (!current.report.cases) {
    const err = current.stderr.trim().split("\n").slice(-5).join("\n");
    console.error(`[eval-changed] eval could not run; not blocking.\n${err}`);
    process.exit(0);
  }
  console.error(`[eval-changed] a changed skill scored below ${THRESHOLD}.`);
  process.exit(1);
}

if (import.meta.main) main();
