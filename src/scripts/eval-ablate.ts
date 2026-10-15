#!/usr/bin/env bun
// Scores the eval cases with the full cc-settings standards loaded against
// vanilla Claude Code, so a skill or rule that no longer beats the bare model
// shows up as a candidate for deletion.
//
// `claude plugin eval` isolates both arms from ~/.claude and never loads a
// CLAUDE.md, so this builds a throwaway plugin whose SessionStart hooks inject
// AGENTS.md, CLAUDE-FULL.md and the output style as additionalContext. Hook
// context is capped near 10K characters, so the text goes in as several
// chunks. The `with` arm gets skills, agents and the standards; the `without`
// arm is vanilla. Not covered: settings.json hooks, permissions, and the
// output style's system-prompt placement.
//
// The CLI orders the two arms inside one `with-without` invocation, so this
// script cannot interleave them. `--aa` interleaves its own invocations.
//
// Usage: bun src/scripts/eval-ablate.ts [--tag <t>]... [--case <glob>]
//          [--runs <n>] [--max-cost-usd <n>] [--model <id>] [--noise <n>]
//        bun src/scripts/eval-ablate.ts --aa [--pairs <n>] [same filters]
// --aa runs the identical plugin twice per pair (A,B then B,A, alternating) and
// prints the score spread it produced. Pass that spread to a normal run as
// --noise: deltas below it print as "within noise".
// Exit 0 when the run produced a report; 1 when it could not run or a result
// row has no arm label.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const JUDGE_MODEL = "claude-haiku-4-5-20251001";
const CHUNK_CHARS = 9000;

export const HELP = `Usage: bun src/scripts/eval-ablate.ts [--tag <t>]... [--case <glob>] [--runs <n>]
                                    [--max-cost-usd <n>] [--model <id>] [--noise <n>]
       bun src/scripts/eval-ablate.ts --aa [--pairs <n>] [--tag <t>]... [--case <glob>]

  --aa                 measure the noise floor: run the identical plugin twice per pair,
                       alternating which run is labeled A first (AB, BA, AB), and report
                       the score spread
  --pairs <n>          A/A pairs (default 3, minimum 2)
  --noise <n>          noise floor from an --aa run; a delta below it prints "within noise"
  --runs <n>           runs per case in a normal comparison (default 1)
  --max-cost-usd <n>   cost ceiling; in --aa mode it is split across the invocations
  -h, --help           show this text`;

export function flag(name: string, fallback: string, argv: string[] = process.argv): string {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : fallback;
}

export function flags(name: string, argv: string[] = process.argv): string[] {
  return argv.flatMap((a, i) => (a === name && argv[i + 1] ? [name, argv[i + 1] as string] : []));
}

export function spread(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
}

export function withinNoise(delta: number, noise: number | null): boolean {
  return noise !== null && Math.abs(delta) < noise;
}

export type AaArm = "A" | "B";

/** Which labeled run goes first in a pair: AB, BA, AB, ... */
export function pairOrder(pair: number): [AaArm, AaArm] {
  return pair % 2 === 0 ? ["A", "B"] : ["B", "A"];
}

export interface AaRow {
  arm: AaArm;
  pair: number;
  position: 1 | 2;
  name: string;
  score: number;
  costUsd: number;
}

interface RunRecord {
  score?: number;
  costUsd?: number;
  error?: string | null;
}

interface CaseReport {
  name: string;
  aggregates?: { score?: number; scoreWithout?: number; delta?: number };
  arms?: Record<string, RunRecord[]>;
}

interface AblationReport {
  partial?: boolean;
  partialReason?: string;
  costUsd?: number;
  cases?: CaseReport[];
}

/** One row per graded run in a report, stamped with the arm the script assigned. */
export function aaRows(
  arm: AaArm,
  pair: number,
  position: 1 | 2,
  report: AblationReport,
): { rows: AaRow[]; errored: number; unlabeled: string[] } {
  const rows: AaRow[] = [];
  const unlabeled: string[] = [];
  let errored = 0;
  for (const c of report.cases ?? []) {
    const runs = Object.values(c.arms ?? {}).flat();
    if (runs.length === 0) unlabeled.push(c.name);
    for (const run of runs) {
      if (run.error) errored++;
      else if (run.score !== undefined) {
        rows.push({
          arm,
          pair,
          position,
          name: c.name,
          score: run.score,
          costUsd: run.costUsd ?? 0,
        });
      }
    }
  }
  return { rows, errored, unlabeled };
}

export interface CaseNoise {
  name: string;
  runs: number;
  scoreSpread: number;
  armGap: number;
  costRatio: number;
  /** Fewer graded runs than expected in either arm: the spread understates the noise. */
  incomplete: boolean;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function caseNoise(rows: AaRow[], runsPerArm = 1): CaseNoise[] {
  const byCase = Map.groupBy(rows, (r) => r.name);
  return [...byCase].map(([name, group]) => {
    const a = group.filter((r) => r.arm === "A").map((r) => r.score);
    const b = group.filter((r) => r.arm === "B").map((r) => r.score);
    const costs = group.map((r) => r.costUsd).filter((c) => c > 0);
    return {
      name,
      runs: group.length,
      scoreSpread: spread(group.map((r) => r.score)),
      armGap: a.length && b.length ? Math.abs(mean(a) - mean(b)) : 0,
      costRatio: costs.length ? Math.max(...costs) / Math.min(...costs) : 1,
      incomplete: a.length < runsPerArm || b.length < runsPerArm,
    };
  });
}

function standardsChunks(): string[] {
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
  // additionalContext does not resolve @-imports; AGENTS.md is inlined instead.
  const full = read("CLAUDE-FULL.md").replace(/^@\S+\.md\s*$/gm, "");
  const text = [read("AGENTS.md"), full, read("output-styles/darkroom.md")].join("\n\n---\n\n");
  const chunks: string[] = [];
  let cur = "";
  for (const para of text.split("\n\n")) {
    if (cur && cur.length + para.length + 2 > CHUNK_CHARS) {
      chunks.push(cur);
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + para;
  }
  if (cur) chunks.push(cur);
  return chunks.map((c, i) => `[cc-settings standards, part ${i + 1} of ${chunks.length}]\n\n${c}`);
}

function buildPlugin(dir: string): void {
  mkdirSync(join(dir, ".claude-plugin"));
  mkdirSync(join(dir, "hooks"));
  writeFileSync(
    join(dir, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "darkroom-full",
      version: "0.0.0",
      description: "cc-settings ablation arm",
    }),
  );
  // src/ and zod back the ~/.claude/src copy below and fixtures that copy repo scripts.
  for (const sub of ["skills", "agents", "src"]) symlinkSync(join(ROOT, sub), join(dir, sub));
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(join(ROOT, "node_modules", "zod"), join(dir, "node_modules", "zod"));
  // The eval runner refuses to write results into a symlinked eval dir.
  cpSync(join(ROOT, "evals"), join(dir, "evals"), {
    recursive: true,
    filter: (src) => !src.startsWith(join(ROOT, "evals", "results")),
  });
  const hooks = standardsChunks().map((ctx, i) => {
    const file = `standards-${i}.json`;
    writeFileSync(
      join(dir, "hooks", file),
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx },
      }),
    );
    return { type: "command", command: `cat "\${CLAUDE_PLUGIN_ROOT}/hooks/${file}"`, timeout: 5 };
  });
  // Skills shell out to ~/.claude/src/scripts/*, which the eval's throwaway
  // HOME lacks; without them they fail and score as regressions. A copy, not
  // a symlink: the agent sandbox blocks reads that resolve into the temp dir.
  const root = "$" + "{CLAUDE_PLUGIN_ROOT}";
  const installScripts = {
    type: "command",
    command: `mkdir -p "$HOME/.claude/node_modules" && cp -RL "${root}/src" "$HOME/.claude/src" && cp -RL "${root}/node_modules/zod" "$HOME/.claude/node_modules/zod"`,
    timeout: 30,
  };
  writeFileSync(
    join(dir, "hooks", "hooks.json"),
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [installScripts, ...hooks] }] } }),
  );
}

function positive(name: string, fallback: string): string {
  const v = flag(name, fallback);
  if (!(Number(v) > 0)) {
    console.error(`[eval-ablate] ${name} needs a positive number, got "${v}".`);
    process.exit(1);
  }
  return v;
}

function evalCmd(plugin: string, out: string, ablation: string, runs: string, maxCost: string[]) {
  return [
    "claude",
    "plugin",
    "eval",
    plugin,
    ...flags("--tag"),
    ...flags("--case"),
    "--runs",
    runs,
    "-j",
    "1",
    "--ablation",
    ablation,
    "--trust-plugin",
    "--scaffold",
    "--allow-tools",
    "Write",
    "Edit",
    "Bash",
    "--no-publish",
    "--model",
    flag("--model", "claude-sonnet-5-5"),
    "--judge-model",
    JUDGE_MODEL,
    "--threshold",
    "0",
    ...maxCost,
    "--json",
    out,
  ];
}

function readReport(path: string): AblationReport {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AblationReport;
  } catch {
    // No report: the CLI failed before writing one. Callers handle the empty case.
    return {};
  }
}

// The eval sandbox blocks writes to ~/.claude, so a skill that saves state
// through its scripts can fail there and still work on a real install.
function usesScripts(caseName: string): boolean {
  const skill = caseName.split("-").reduceRight<string | null>((found, _, i, parts) => {
    if (found) return found;
    const name = parts.slice(0, i + 1).join("-");
    return existsSync(join(ROOT, "skills", name, "SKILL.md")) ? name : null;
  }, null);
  if (!skill) return false;
  return /(\$HOME|~)\/\.claude\/src\//.test(
    readFileSync(join(ROOT, "skills", skill, "SKILL.md"), "utf8"),
  );
}

function reportAa(
  pairs: number,
  rows: AaRow[],
  errored: number,
  costUsd: number | undefined,
): boolean {
  const noise = caseNoise(rows, pairs);
  const order = Array.from({ length: pairs }, (_, p) => pairOrder(p).join("")).join(" ");
  console.log(
    `A/A noise floor: ${rows.length} graded runs, ${pairs} pairs (${order}), one plugin.`,
  );
  console.log("  spread  A-B gap  cost max/min  case");
  for (const n of noise) {
    console.log(
      `  ${n.scoreSpread.toFixed(2)}    ${n.armGap.toFixed(2)}     ${n.costRatio.toFixed(1)}x          ${n.name} (${n.runs} runs)`,
    );
  }
  const floor = Math.max(0, ...noise.map((n) => n.scoreSpread));
  const incomplete = noise.filter((n) => n.incomplete).map((n) => n.name);
  if (incomplete.length > 0) {
    console.log(
      `\nno usable noise floor: ${incomplete.join(", ")} lack ${pairs} graded run(s) in each arm. Rerun before passing --noise.`,
    );
  } else {
    console.log(`\nnoise floor (largest case spread): ${floor.toFixed(2)}`);
    console.log(`pass it to a normal run: --noise ${floor.toFixed(2)}`);
  }
  console.log(
    "The report carries score, cost and turns per run but no token counts, so cost max/min stands in for output-token spread.",
  );
  if (noise.some((n) => n.armGap >= floor && floor > 0)) {
    console.log(
      "An A-B gap as large as the spread means the identical arms differ: check the harness before trusting a delta.",
    );
  }
  if (errored > 0) console.log(`${errored} run(s) errored and are excluded.`);
  if (costUsd !== undefined) console.log(`cost $${costUsd.toFixed(2)}`);
  return incomplete.length === 0;
}

function main(): void {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }
  if (!Bun.which("claude")) {
    console.error("[eval-ablate] claude CLI not found.");
    process.exit(1);
  }

  // The CLI keeps only the last --case, so a second one would be silently dropped.
  if (flags("--case").length > 2) {
    console.error("[eval-ablate] --case takes one name glob; run once per case or use --tag.");
    process.exit(1);
  }
  const aa = process.argv.includes("--aa");
  const runs = positive("--runs", "1");
  const pairs = aa ? Number(positive("--pairs", "3")) : 0;
  if (aa && (!Number.isInteger(pairs) || pairs < 2)) {
    console.error("[eval-ablate] --pairs needs an integer of at least 2.");
    process.exit(1);
  }
  const noiseArg = flag("--noise", "");
  const noise = process.argv.includes("--noise") ? Number(noiseArg) : null;
  if (noise !== null && !(Number.isFinite(noise) && noise >= 0 && noiseArg !== "")) {
    console.error(`[eval-ablate] --noise needs a number of 0 or more, got "${noiseArg}".`);
    process.exit(1);
  }
  // No default ceiling: on a subscription the reported cost is API-equivalent,
  // not billed, and a manual run should finish. Pass the flag to bound one.
  const invocations = aa ? pairs * 2 : 1;
  const maxCost = process.argv.includes("--max-cost-usd")
    ? ["--max-cost-usd", String(Number(positive("--max-cost-usd", "")) / invocations)]
    : [];

  const plugin = mkdtempSync(join(tmpdir(), "cc-settings-ablate-"));
  const outs: string[] = [];
  const kept = join(
    homedir(),
    ".claude",
    "tmp",
    // The mkdtemp suffix keeps parallel runs from sharing a directory.
    `eval-ablate-${new Date().toISOString().replace(/[:.]/g, "-")}-${basename(plugin).slice(-6)}`,
  );
  let exitCode: number | null = 0;
  let report: AblationReport = {};
  const aaResult = { rows: [] as AaRow[], errored: 0, unlabeled: [] as string[], costUsd: 0 };
  try {
    buildPlugin(plugin);
    if (aa) {
      for (let pair = 0; pair < pairs; pair++) {
        pairOrder(pair).forEach((arm, i) => {
          const out = join(plugin, `report-${pair}-${arm}.json`);
          outs.push(out);
          const proc = Bun.spawnSync({
            cmd: evalCmd(plugin, out, "none", "1", maxCost),
            cwd: plugin,
            stdout: "pipe",
            stderr: "inherit",
          });
          exitCode = proc.exitCode;
          const r = readReport(out);
          const parsed = aaRows(arm, pair, i === 0 ? 1 : 2, r);
          aaResult.rows.push(...parsed.rows);
          aaResult.errored += parsed.errored;
          aaResult.unlabeled.push(
            ...parsed.unlabeled.map((n) => `${n} (pair ${pair + 1}, ${arm})`),
          );
          aaResult.costUsd += r.costUsd ?? 0;
          if (!r.cases) aaResult.unlabeled.push(`(no report) (pair ${pair + 1}, ${arm})`);
        });
      }
    } else {
      const out = join(plugin, "report.json");
      outs.push(out);
      const proc = Bun.spawnSync({
        cmd: evalCmd(plugin, out, "with-without", runs, maxCost),
        cwd: plugin,
        stdout: "pipe",
        stderr: "inherit",
      });
      exitCode = proc.exitCode;
      report = readReport(out);
    }
  } finally {
    // Keep the HTML report and transcripts: the temp plugin dir is deleted.
    // A failed copy keeps that dir so the results are not lost.
    let archived = true;
    if (existsSync(join(plugin, "evals", "results"))) {
      try {
        cpSync(join(plugin, "evals", "results"), kept, { recursive: true });
        for (const out of outs) if (existsSync(out)) cpSync(out, join(kept, basename(out)));
      } catch (err) {
        archived = false;
        console.error(`[eval-ablate] could not keep results, left them in ${plugin}: ${err}`);
      }
    }
    if (archived) rmSync(plugin, { recursive: true, force: true });
  }

  if (aa) {
    if (aaResult.unlabeled.length > 0) {
      console.error(
        `[eval-ablate] result rows without an arm label, not scoring: ${aaResult.unlabeled.join(", ")}`,
      );
      process.exit(1);
    }
    if (aaResult.rows.length === 0) {
      console.error(`[eval-ablate] no graded runs to measure (exit ${exitCode}).`);
      process.exit(1);
    }
    const usable = reportAa(pairs, aaResult.rows, aaResult.errored, aaResult.costUsd);
    if (existsSync(kept)) console.log(`results and transcripts: ${kept}`);
    if (!usable) process.exit(1);
    return;
  }

  if (!report.cases) {
    console.error(`[eval-ablate] eval did not produce a report (exit ${exitCode}).`);
    process.exit(1);
  }

  if (report.partial) console.log(`partial run: ${report.partialReason ?? "unknown reason"}\n`);
  const complete = report.cases.filter(
    (c) =>
      c.aggregates?.score !== undefined &&
      c.aggregates.scoreWithout !== undefined &&
      c.aggregates.delta !== undefined,
  );
  const unlabeled = complete.filter(
    (c) => (c.arms?.with?.length ?? 0) === 0 || (c.arms?.without?.length ?? 0) === 0,
  );
  if (unlabeled.length > 0) {
    console.error(
      `[eval-ablate] result rows without an arm label, not scoring: ${unlabeled.map((c) => c.name).join(", ")}`,
    );
    process.exit(1);
  }
  const notRun = report.cases.length - complete.length;
  const rows = complete
    .map((c) => ({
      name: c.name,
      with: c.aggregates?.score ?? 0,
      without: c.aggregates?.scoreWithout ?? 0,
      delta: c.aggregates?.delta ?? 0,
      errors: Object.values(c.arms ?? {})
        .flat()
        .filter((run) => run.error).length,
    }))
    .sort((a, b) => a.delta - b.delta);
  console.log("  with  vanilla  delta  case");
  for (const r of rows) {
    const mark =
      (r.errors > 0
        ? `  <- ${r.errors} run(s) errored`
        : r.delta <= 0
          ? "  <- vanilla matches"
          : withinNoise(r.delta, noise)
            ? "  <- within noise"
            : "") + (usesScripts(r.name) ? "  [uses ~/.claude scripts]" : "");
    console.log(
      `  ${r.with.toFixed(2)}  ${r.without.toFixed(2)}     ${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(2)}  ${r.name}${mark}`,
    );
  }
  const matched = rows.filter((r) => r.errors === 0 && r.delta <= 0).length;
  console.log(`\n${matched} of ${rows.length} compared cases: vanilla scores at least as well.`);
  if (noise !== null) {
    const small = rows.filter((r) => r.errors === 0 && r.delta > 0 && withinNoise(r.delta, noise));
    console.log(
      `${small.length} positive delta(s) below the A/A noise floor ${noise}: not evidence the standards help.`,
    );
  } else {
    console.log("No noise floor given (--aa measures one): treat small deltas as unproven.");
  }
  if (notRun > 0) console.log(`${notRun} case(s) had no comparison (not run or not graded).`);
  if (report.costUsd !== undefined) console.log(`cost $${report.costUsd.toFixed(2)}`);
  if (rows.some((r) => usesScripts(r.name)))
    console.log(
      "[uses ~/.claude scripts]: the eval sandbox blocks writes there; re-check by hand.",
    );
  if (existsSync(kept)) console.log(`results and transcripts: ${kept}`);
}

if (import.meta.main) main();
