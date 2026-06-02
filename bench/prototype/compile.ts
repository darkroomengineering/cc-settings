#!/usr/bin/env bun

// Prototype: `bun build --compile` one leaf script (notify.ts) and measure
// binary size + cold-start p50/p95 on macOS. Output committed as commentary;
// raw data lives in bench/prototype/result.json.

import { existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const SRC = join(ROOT, "bench", "prototype", "notify.ts");
const DIST = join(ROOT, "bench", "prototype", "dist");
const BIN = join(DIST, "notify-proto");
const OUTFILE = join(ROOT, "bench", "prototype", "result.json");

const ITERS = 100;
const WARMUP = 10;

function pct(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

async function compile() {
  if (existsSync(DIST)) await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  const t0 = performance.now();
  const proc = Bun.spawn(["bun", "build", "--compile", "--minify", SRC, "--outfile", BIN], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = (await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])) as [string, string, number];
  const compileMs = performance.now() - t0;
  if (code !== 0) {
    console.error(stdout);
    console.error(stderr);
    throw new Error(`bun build --compile failed with exit ${code}`);
  }
  return { compileMs, stdout: stdout + stderr };
}

async function coldStart(path: string, env: Record<string, string>): Promise<number> {
  const t0 = performance.now();
  const proc = Bun.spawn([path], {
    env: { ...process.env, ...env },
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
  return performance.now() - t0;
}

async function bench(path: string, label: string) {
  // NOTIFICATION_MESSAGE empty → the script short-circuits before the OS call,
  // so we measure pure interpreter/binary startup + module init. That's the
  // signal we care about for hot-path hooks.
  const env = { NOTIFICATION_MESSAGE: "" };
  for (let i = 0; i < WARMUP; i++) await coldStart(path, env);
  const samples: number[] = [];
  for (let i = 0; i < ITERS; i++) samples.push(await coldStart(path, env));
  const sorted = [...samples].sort((a, b) => a - b);
  const result = {
    label,
    p50: +pct(sorted, 50).toFixed(2),
    p95: +pct(sorted, 95).toFixed(2),
    p99: +pct(sorted, 99).toFixed(2),
    min: +(sorted[0] ?? 0).toFixed(2),
    max: +(sorted[sorted.length - 1] ?? 0).toFixed(2),
    iters: samples.length,
  };
  console.log(
    `  ${label.padEnd(26)} p50=${String(result.p50).padStart(6)}ms  p95=${String(result.p95).padStart(6)}ms  p99=${String(result.p99).padStart(6)}ms`,
  );
  return result;
}

async function benchBunRuntime() {
  // Compare against `bun run notify.ts` cold starts to quantify compile gain.
  const env = { NOTIFICATION_MESSAGE: "" };
  for (let i = 0; i < WARMUP; i++) {
    const p = Bun.spawn(["bun", "run", SRC], {
      env: { ...process.env, ...env },
      stdout: "ignore",
      stderr: "ignore",
    });
    await p.exited;
  }
  const samples: number[] = [];
  for (let i = 0; i < ITERS; i++) {
    const t0 = performance.now();
    const p = Bun.spawn(["bun", "run", SRC], {
      env: { ...process.env, ...env },
      stdout: "ignore",
      stderr: "ignore",
    });
    await p.exited;
    samples.push(performance.now() - t0);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const result = {
    label: "bun run notify.ts",
    p50: +pct(sorted, 50).toFixed(2),
    p95: +pct(sorted, 95).toFixed(2),
    p99: +pct(sorted, 99).toFixed(2),
    min: +(sorted[0] ?? 0).toFixed(2),
    max: +(sorted[sorted.length - 1] ?? 0).toFixed(2),
    iters: samples.length,
  };
  console.log(
    `  ${result.label.padEnd(26)} p50=${String(result.p50).padStart(6)}ms  p95=${String(result.p95).padStart(6)}ms  p99=${String(result.p99).padStart(6)}ms`,
  );
  return result;
}

async function main() {
  console.log(`bun build --compile prototype (notify.ts) — iters=${ITERS} warmup=${WARMUP}`);
  const { compileMs } = await compile();
  const sizeBytes = (await stat(BIN)).size;
  const sizeMB = +(sizeBytes / 1024 / 1024).toFixed(2);
  console.log(`  compile:      ${compileMs.toFixed(0)}ms`);
  console.log(`  binary size:  ${sizeBytes.toLocaleString()} bytes (${sizeMB} MB)`);
  console.log("");
  console.log("cold-start (NOTIFICATION_MESSAGE empty → pure startup):");

  const compiled = await bench(BIN, "compiled binary");
  const interpreted = await benchBunRuntime();

  const speedup = +(interpreted.p50 / compiled.p50).toFixed(2);
  console.log(`\n  compiled p50 is ${speedup}× faster than \`bun run\` p50`);

  const payload = {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    system: {
      bun: Bun.version,
      arch: process.arch,
      platform: process.platform,
    },
    compile: {
      sourceLoc: (await Bun.file(SRC).text()).split("\n").length,
      compileMs: +compileMs.toFixed(0),
      binaryBytes: sizeBytes,
      binaryMB: sizeMB,
    },
    benchmarks: {
      compiled,
      interpreted,
    },
    conclusion: {
      speedupVsBunRun: speedup,
      fitsHotPathBudget: compiled.p95 < 50,
      recommendation:
        compiled.p95 < 50
          ? "cc-hook compiled binary is viable for <50ms hot-path budget"
          : "compiled binary exceeds 50ms hot-path budget — revisit strategy",
    },
  };

  const { writeFile } = await import("node:fs/promises");
  await writeFile(OUTFILE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nWrote ${OUTFILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
