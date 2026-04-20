#!/usr/bin/env bun

// Baseline bash-hook benchmark — Phase -1 groundwork.
//
// Wall-clock p50/p95/p99 over N iterations per hook, on the current .sh
// implementations. Output is committed to bench/baseline-bash.json and becomes
// the regression target the TS port must beat (or at least stay within budget).
//
// Run: bun run bench:baseline [--iters=100] [--warmup=10]

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const SCRIPTS = join(REPO, "scripts");
const OUTFILE = join(REPO, "bench", "baseline-bash.json");

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);
const ITERS = Number(args.get("iters") ?? 100);
const WARMUP = Number(args.get("warmup") ?? 10);

// Isolated HOME so session-start/post-edit side effects don't touch the
// user's real ~/.claude. Pre-created once per full run so log files are
// absent (each iteration hits the same cold state).
const BENCH_HOME = join(tmpdir(), `cc-bench-home-${process.pid}`);
const BENCH_CWD = join(tmpdir(), `cc-bench-cwd-${process.pid}`);

async function setupHome() {
  if (existsSync(BENCH_HOME)) await rm(BENCH_HOME, { recursive: true, force: true });
  await mkdir(join(BENCH_HOME, ".claude", "logs"), { recursive: true });
  await mkdir(join(BENCH_HOME, ".claude", "handoffs"), { recursive: true });
  await mkdir(join(BENCH_HOME, ".claude", "tmp"), { recursive: true });
  await mkdir(join(BENCH_HOME, ".claude", "tldr-cache"), { recursive: true });

  if (existsSync(BENCH_CWD)) await rm(BENCH_CWD, { recursive: true, force: true });
  await mkdir(BENCH_CWD, { recursive: true });
  // No package.json / .git so session-start's auto_warm_tldr short-circuits.

  // Sample TS file for post-edit / post-edit-tsc timing (no tsconfig → tsc skip).
  await writeFile(join(BENCH_CWD, "sample.ts"), "export const x: number = 1;\n");
}

async function teardown() {
  await rm(BENCH_HOME, { recursive: true, force: true }).catch(() => {});
  await rm(BENCH_CWD, { recursive: true, force: true }).catch(() => {});
}

type RunSpec = {
  name: string;
  script: string;
  env?: Record<string, string>;
  stdin?: string;
  cwd?: string;
  budgetMs: number; // from MIGRATION.md perf budgets
};

const STATUSLINE_INPUT = JSON.stringify({
  model: { display_name: "Opus 4.7" },
  workspace: { current_dir: REPO },
  context_window: { used_percentage: 42, context_window_size: 1_000_000 },
  rate_limits: { five_hour: { used_percentage: 30, resets_at: "2026-04-20T15:00:00Z" } },
});

// One representative command per hook category.
// safety-net is measured on an "analyze" path (has `git`) — the hot case.
const SAFETY_NET_CMD = "git status && git log --oneline";

const specs: RunSpec[] = [
  {
    name: "safety-net",
    script: "safety-net.sh",
    env: { TOOL_INPUT_command: SAFETY_NET_CMD },
    budgetMs: 50,
  },
  {
    name: "safety-net-fastpath",
    script: "safety-net.sh",
    env: { TOOL_INPUT_command: "ls -la" }, // hits the `no dangerous token` fast exit
    budgetMs: 50,
  },
  {
    name: "statusline",
    script: "statusline.sh",
    stdin: STATUSLINE_INPUT,
    cwd: REPO, // needs a real git repo for branch lookup
    budgetMs: 100,
  },
  {
    name: "post-edit",
    script: "post-edit.sh",
    env: { TOOL_INPUT_file_path: join(BENCH_CWD, "sample.ts") },
    budgetMs: 75,
  },
  {
    name: "post-edit-tsc",
    script: "post-edit-tsc.sh",
    env: { TOOL_INPUT_file_path: join(BENCH_CWD, "sample.ts") },
    cwd: BENCH_CWD, // no tsconfig → early exit, measures startup
    budgetMs: 200,
  },
  {
    name: "session-start",
    script: "session-start.sh",
    cwd: BENCH_CWD,
    budgetMs: 300,
  },
];

async function runOnce(spec: RunSpec): Promise<number> {
  const start = performance.now();
  const proc = Bun.spawn(["bash", join(SCRIPTS, spec.script)], {
    cwd: spec.cwd ?? BENCH_CWD,
    env: {
      ...process.env,
      HOME: BENCH_HOME,
      ...(spec.env ?? {}),
    },
    stdin: spec.stdin ? new TextEncoder().encode(spec.stdin) : "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
  return performance.now() - start;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

async function bench(spec: RunSpec) {
  // Warmup (discarded).
  for (let i = 0; i < WARMUP; i++) await runOnce(spec);

  const samples: number[] = [];
  for (let i = 0; i < ITERS; i++) samples.push(await runOnce(spec));

  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    p50: +pct(sorted, 50).toFixed(2),
    p95: +pct(sorted, 95).toFixed(2),
    p99: +pct(sorted, 99).toFixed(2),
    mean: +mean.toFixed(2),
    min: +(sorted[0] ?? 0).toFixed(2),
    max: +(sorted[sorted.length - 1] ?? 0).toFixed(2),
    iters: samples.length,
    budgetMs: spec.budgetMs,
    overBudget: pct(sorted, 95) > spec.budgetMs,
  };
}

async function systemInfo() {
  const proc = Bun.spawn(["uname", "-srm"], { stdout: "pipe" });
  const uname = (await new Response(proc.stdout).text()).trim();
  const bunVer = Bun.version;
  const bashProc = Bun.spawn(["bash", "--version"], { stdout: "pipe" });
  const bashVer = (await new Response(bashProc.stdout).text()).split("\n")[0];
  return { uname, bun: bunVer, bash: bashVer, arch: process.arch, platform: process.platform };
}

async function main() {
  console.log(`cc-settings baseline bench — iters=${ITERS} warmup=${WARMUP}`);
  await setupHome();

  const results: Record<string, unknown> = {};
  for (const spec of specs) {
    process.stdout.write(`  ${spec.name.padEnd(24)} `);
    const r = await bench(spec);
    results[spec.name] = r;
    const marker = r.overBudget ? "OVER" : "ok";
    console.log(
      `p50=${String(r.p50).padStart(6)}ms  p95=${String(r.p95).padStart(6)}ms  p99=${String(r.p99).padStart(6)}ms  budget=${r.budgetMs}ms [${marker}]`,
    );
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    runtime: "bash",
    system: await systemInfo(),
    hooks: results,
    notes: [
      "p95 is the CI-enforced metric; see docs/migration-coexistence.md for budgets.",
      "Isolated HOME: no tldr warm, no real log rotation. Comparable across TS/bash runs.",
      "post-edit-tsc measured without tsconfig → early-exit path (startup overhead only).",
      "safety-net measured on both analyze path (git ...) and fast-exit path (ls -la).",
    ],
  };

  await writeFile(OUTFILE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nWrote ${OUTFILE}`);

  await teardown();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
