#!/usr/bin/env bun
// Bench regression gate. Re-runs the baseline harness and fails if any hook's
// p95 regresses > MAX_REGRESSION_PCT vs the committed bench/baseline-bash.json.
//
// The baseline is bash (hot hooks haven't been cut over yet). Once Phase 6
// flips, we'll add a bench/baseline-ts.json and swap the comparison target.
//
// Run: bun bench/regression-check.ts [--iters=20] [--max=0.20]

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const BASELINE = resolve(ROOT, "bench", "baseline-bash.json");

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);
const ITERS = Number(args.get("iters") ?? 20);
const MAX_REGRESSION = Number(args.get("max") ?? 0.2);

type HookStats = {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
  iters: number;
  budgetMs: number;
  overBudget: boolean;
};

type Baseline = {
  runtime: string;
  hooks: Record<string, HookStats>;
};

// Snapshot the committed baseline, then re-run the harness (it overwrites
// the file), read fresh, then restore. Avoids polluting git state.
async function measure(): Promise<{ committed: Baseline; fresh: Baseline }> {
  const committedRaw = await readFile(BASELINE, "utf8");
  const committed = JSON.parse(committedRaw) as Baseline;

  const proc = Bun.spawn(
    ["bun", resolve(ROOT, "bench", "run-baseline.ts"), `--iters=${ITERS}`, "--warmup=3"],
    { cwd: ROOT, stdout: "ignore", stderr: "ignore" },
  );
  const code = await proc.exited;
  if (code !== 0) throw new Error(`bench harness exited ${code}`);
  const fresh = JSON.parse(await readFile(BASELINE, "utf8")) as Baseline;

  // Restore the committed file so CI / local runs leave git clean.
  await writeFile(BASELINE, committedRaw);
  return { committed, fresh };
}

async function main() {
  const { committed, fresh } = await measure();

  let regressions = 0;
  let improvements = 0;
  const rows: string[] = [];
  rows.push(
    `${"hook".padEnd(24)} ${"committed".padStart(10)} ${"fresh".padStart(10)} ${"Δ".padStart(8)}`,
  );
  rows.push("-".repeat(60));
  for (const [name, cStats] of Object.entries(committed.hooks)) {
    const fStats = fresh.hooks[name];
    if (!fStats) continue;
    const delta = (fStats.p95 - cStats.p95) / cStats.p95;
    const arrow = delta > MAX_REGRESSION ? " FAIL" : delta > 0 ? "" : " ok";
    rows.push(
      `${name.padEnd(24)} ${String(cStats.p95).padStart(10)} ${String(fStats.p95).padStart(10)} ${(
        delta * 100
      )
        .toFixed(1)
        .padStart(6)}%${arrow}`,
    );
    if (delta > MAX_REGRESSION) regressions++;
    if (delta < -0.1) improvements++;
  }

  console.log(rows.join("\n"));
  console.log("");
  console.log(`max allowed regression: ${(MAX_REGRESSION * 100).toFixed(0)}%`);
  console.log(`regressions: ${regressions}, improvements ≥10%: ${improvements}`);
  if (regressions > 0) {
    console.error("regression detected — failing gate.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
