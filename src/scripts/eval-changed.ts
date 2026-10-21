#!/usr/bin/env bun
// Runs the `claude plugin eval` cases for skills changed since the upstream
// branch, so a skill edit is checked against its own eval before it ships.
// Cases live in evals/<skill>-<slug>/ and select a skill with `tags: [<skill>]`.
//
// Usage: bun src/scripts/eval-changed.ts [--base <ref>] [--max-cost-usd <n>] [--runs <n>]
//        [--base-arm] [--triggers]
// --base-arm also runs the cases against the version of each changed skill at
// the merge-base with <ref>, labels every case improvement, regression,
// no-regression-only, or still-failing, and adds two blocking rules (see HELP).
// The cost ceiling covers both arms.
// Exit 0: nothing changed, every case passed, or the run could not finish
// (missing CLI, auth, cost ceiling), which warns instead of blocking.
// Exit 1: a changed skill has no case, a blocking rule fired, or
// evals/quarantine.json has an expired or malformed entry.

import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CaseRuns,
  CRITICAL_TAG,
  gate,
  parseQuarantine,
  type Quarantine,
  removedCases,
} from "../lib/eval-gate.ts";
import { evalCaseTags } from "../lib/lint-skills.ts";
import {
  checkTriggers,
  descriptionChanged,
  positiveNumber,
  DEFAULT_MAX_COST as TRIGGER_MAX_COST,
  DEFAULT_RUNS as TRIGGER_RUNS,
  triggerSetPath,
} from "./eval-triggers.ts";

const ROOT = join(import.meta.dir, "..", "..");
const MODEL = "claude-sonnet-5-5";
// The judge is a different, stronger model than the one the cases run on, so it
// never grades answers from its own model.
const JUDGE_MODEL = "claude-fable-5-1";
const THRESHOLD = "0.8";
const QUARANTINE_FILE = "evals/quarantine.json";

export const HELP = `Usage: bun src/scripts/eval-changed.ts [--base <ref>] [--max-cost-usd <n>] [--runs <n>] [--base-arm] [--triggers]

  --base <ref>         diff against <ref> (default: upstream branch, else origin/main)
  --max-cost-usd <n>   cost ceiling in USD (default 5); with --base-arm it covers both arms
  --runs <n>           runs per case in each arm (default 1)
  --base-arm           also run each changed skill's cases against its merge-base version
                       and label every case: improvement, regression, no-regression-only,
                       or still-failing. Two more rules then block:
                       - a case tagged \`${CRITICAL_TAG}\` that passed every base run and
                         failed any candidate run
                       - a case tagged with a changed skill at the merge-base that the
                         branch deleted, renamed, or untagged
  --triggers           for each changed skill whose description changed, also run the
                       trigger check in evals/triggers/<skill>.json (src/scripts/eval-triggers.ts,
                       ${TRIGGER_RUNS} runs per prompt, up to $${TRIGGER_MAX_COST} per skill on top of the ceiling);
                       a skill with no prompt set warns
  -h, --help           show this text

A case listed in ${QUARANTINE_FILE} ({case, owner, expires: YYYY-MM-DD, reason})
does not block. An expired or malformed entry blocks.`;

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

export interface EvalReport {
  partial?: boolean;
  partialReason?: string;
  costUsd?: number;
  cases?: {
    name: string;
    aggregates?: { score?: number };
    arms?: Record<string, { score?: number; error?: string | null }[]>;
  }[];
}

interface Arm {
  exitCode: number | null;
  stderr: string;
  report: EvalReport;
}

function runArm(
  plugin: string,
  targets: string[],
  maxCost: string,
  label: string,
  runs: string,
): Arm {
  const out = join(tmpdir(), `cc-settings-eval-${label}-${process.pid}.json`);
  const proc = Bun.spawnSync({
    cmd: [
      "claude",
      "plugin",
      "eval",
      plugin,
      ...targets.flatMap((t) => ["--tag", t]),
      "--runs",
      runs,
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

// The eval cases and their tags as of `mergeBase`. The base arm cannot show a
// deleted case because buildBasePlugin copies evals/ from the working tree.
function casesAt(mergeBase: string): Array<[string, string[]]> {
  const dir = mkdtempSync(join(tmpdir(), "cc-settings-eval-cases-"));
  try {
    const archive = Bun.spawnSync({
      cmd: ["git", "archive", "--format=tar", mergeBase, "evals"],
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (archive.exitCode !== 0) return [];
    const untar = Bun.spawnSync({
      cmd: ["tar", "-x", "-C", dir],
      stdin: archive.stdout,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (untar.exitCode !== 0) throw new Error(`could not extract evals/ from ${mergeBase}`);
    return evalCaseTags(join(dir, "evals"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function scores(report: EvalReport): Map<string, number> {
  return new Map((report.cases ?? []).map((c) => [c.name, c.aggregates?.score ?? 0]));
}

/** Aggregate and per-run scores per case; errored runs are left out of `runs`. */
export function caseRuns(report: EvalReport): Map<string, CaseRuns> {
  return new Map(
    (report.cases ?? []).map((c) => {
      const score = c.aggregates?.score ?? 0;
      if (!c.arms) return [c.name, { score, runs: [score] }];
      const runs = Object.values(c.arms)
        .flat()
        .filter((r) => !r.error && typeof r.score === "number")
        .map((r) => r.score as number);
      return [c.name, { score, runs }];
    }),
  );
}

function loadQuarantine(): Quarantine {
  const path = join(ROOT, QUARANTINE_FILE);
  if (!existsSync(path)) return { active: new Map(), problems: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { active: new Map(), problems: [`not valid JSON: ${(err as Error).message}`] };
  }
  return parseQuarantine(raw, new Date().toISOString().slice(0, 10));
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

/** True when a skill's trigger check fell below its thresholds. */
function runTriggerChecks(targets: string[], mergeBase: string | null): boolean {
  if (mergeBase === null) {
    console.error(
      "[eval-changed] no merge-base; cannot tell which descriptions changed, skipping --triggers.",
    );
    return false;
  }
  let blocked = false;
  for (const skill of targets) {
    const path = join(ROOT, "skills", skill, "SKILL.md");
    if (!existsSync(path)) continue;
    const before = git(["show", `${mergeBase}:skills/${skill}/SKILL.md`]);
    if (!descriptionChanged(before, readFileSync(path, "utf8"))) continue;
    if (!existsSync(triggerSetPath(skill))) {
      console.error(
        `[eval-changed] ${skill}: description changed but evals/triggers/${skill}.json is missing; no trigger check.`,
      );
      continue;
    }
    console.error(`[eval-changed] trigger check for ${skill}`);
    const outcome = checkTriggers({
      skill,
      runs: TRIGGER_RUNS,
      maxCost: TRIGGER_MAX_COST,
      model: MODEL,
    });
    console.error(`[eval-changed] ${skill} triggers: ${outcome.status}, ${outcome.reason}`);
    if (outcome.status === "fail") blocked = true;
  }
  return blocked;
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

  const wantsBaseArm = process.argv.includes("--base-arm");
  const wantsTriggers = process.argv.includes("--triggers");
  const mergeBase = wantsBaseArm || wantsTriggers ? git(["merge-base", base, "HEAD"]) : null;
  if (wantsBaseArm && mergeBase === null) {
    console.error(`[eval-changed] no merge-base with ${base}; running without --base-arm.`);
  }
  const baseCommit = wantsBaseArm ? mergeBase : null;

  const skills = skillNames();
  const cases = new Map(evalCaseTags(join(ROOT, "evals")));
  const baseCases = baseCommit !== null ? casesAt(baseCommit) : [];
  // A case deleted on the branch has no working-tree tags, so its merge-base
  // tags are what mark its skill changed.
  const baseTags = new Map(baseCases);
  const changed = new Set<string>();
  for (const file of diff.split("\n")) {
    const [top, name] = file.split("/");
    if (top === "skills" && name && skills.has(name)) changed.add(name);
    if (top === "evals" && name) {
      for (const tag of cases.get(name) ?? baseTags.get(name) ?? []) {
        if (skills.has(tag)) changed.add(tag);
      }
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

  const quarantine = loadQuarantine();
  if (quarantine.problems.length > 0) {
    console.error(`[eval-changed] ${QUARANTINE_FILE}:\n  ${quarantine.problems.join("\n  ")}`);
    process.exit(1);
  }

  let runs: string;
  try {
    runs = String(positiveNumber("--runs", flag("--runs", "1"), true));
  } catch (err) {
    console.error(`[eval-changed] ${(err as Error).message}`);
    process.exit(1);
  }

  const targets = [...changed].sort();
  const threshold = Number(THRESHOLD);
  const critical = new Set(
    [...cases].filter(([, tags]) => tags.includes(CRITICAL_TAG)).map(([name]) => name),
  );

  // Checked before any paid run: it needs only git.
  if (baseCommit !== null) {
    const removed = gate({
      candidate: new Map(),
      base: null,
      critical,
      removed: removedCases(baseCases, cases, changed),
      quarantine: quarantine.active,
      threshold,
    });
    for (const v of removed) {
      console.error(
        `  ${v.quarantined ? "quarantined" : "BLOCK"}  ${v.rule}  ${v.case}: ${v.detail}`,
      );
    }
    if (removed.some((v) => !v.quarantined)) {
      console.error(
        "[eval-changed] restore the missing cases, or list each one in " +
          `${QUARANTINE_FILE} with an owner and an expiry date.`,
      );
      process.exit(1);
    }
  }

  if (!Bun.which("claude")) {
    console.error("[eval-changed] claude CLI not found; skipping skill evals.");
    process.exit(0);
  }

  const totalCost = flag("--max-cost-usd", "5");
  const armCost = baseCommit !== null ? splitCost(totalCost, 2) : totalCost;

  console.error(
    `[eval-changed] running evals for: ${targets.join(", ")} (${runs} run(s) per case)`,
  );
  const current = runArm(ROOT, targets, armCost, "current", runs);

  for (const c of current.report.cases ?? []) {
    const score = c.aggregates?.score ?? 0;
    console.error(`  ${score >= threshold ? "pass" : "FAIL"} ${score.toFixed(2)}  ${c.name}`);
  }
  let cost = current.report.costUsd;

  let baseRuns: Map<string, CaseRuns> | null = null;
  if (baseCommit !== null) {
    const { dir, added } = buildBasePlugin(baseCommit, targets);
    try {
      const baseTargets = targets.filter((t) => !added.includes(t));
      if (added.length > 0) {
        console.error(`[eval-changed] no base version for new skill(s): ${added.join(", ")}`);
      }
      if (baseTargets.length > 0) {
        console.error(
          `[eval-changed] base arm at ${baseCommit.slice(0, 9)} for: ${baseTargets.join(", ")}`,
        );
        const old = runArm(dir, baseTargets, armCost, "base", runs);
        if (old.report.cases) {
          reportBaseArm(old, current);
          baseRuns = caseRuns(old.report);
        } else {
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

  let blocked = false;
  if (current.exitCode === 2 || current.report.partial) {
    console.error(
      `[eval-changed] eval run incomplete (${current.report.partialReason ?? "partial"}); not blocking.`,
    );
  } else if (!current.report.cases) {
    const err = current.stderr.trim().split("\n").slice(-5).join("\n");
    console.error(`[eval-changed] eval could not run; not blocking.\n${err}`);
  } else {
    const verdicts = gate({
      candidate: caseRuns(current.report),
      base: baseRuns,
      critical,
      removed: [],
      quarantine: quarantine.active,
      threshold,
    });
    for (const v of verdicts) {
      console.error(
        `  ${v.quarantined ? "quarantined" : "BLOCK"}  ${v.rule}  ${v.case}: ${v.detail}`,
      );
    }
    if (verdicts.some((v) => !v.quarantined)) {
      console.error(`[eval-changed] a changed skill's case failed a blocking rule.`);
      blocked = true;
    }
  }

  if (wantsTriggers && runTriggerChecks(targets, mergeBase)) blocked = true;
  process.exit(blocked ? 1 : 0);
}

if (import.meta.main) main();
