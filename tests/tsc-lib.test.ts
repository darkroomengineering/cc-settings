import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTsc } from "../src/lib/tsc.ts";

/** A throwaway project with one deliberately broken file. */
function brokenProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "cc-tsclib-"));
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["*.ts"] }),
  );
  writeFileSync(join(dir, "a.ts"), 'export const x: number = "nope";\n');
  return dir;
}

describe("runTsc", () => {
  test("reports type errors and exits non-zero", async () => {
    const dir = brokenProject();
    try {
      const r = await runTsc({ cwd: dir });
      expect(r.exitCode).not.toBe(0);
      expect(r.combined).toContain("TS2322");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 130_000);

  // Regression: `--pretty` colourises even when piped, splitting the header as
  // `error<ESC>[0m<ESC>[90m TS2322`. The cache-retry matcher expects
  // `error TS####`, so without stripping ANSI it can never fire on the
  // pre-commit path — an unusable cache would block the commit instead of
  // falling back to a cold run.
  test("pretty output still carries a matchable diagnostic once ANSI is stripped", async () => {
    const dir = brokenProject();
    try {
      const r = await runTsc({ cwd: dir, pretty: true });
      expect(r.exitCode).not.toBe(0);
      // Raw pretty output does NOT contain the adjacent form the matcher wants.
      expect(/error TS\d+/.test(r.combined)).toBe(false);
      // Stripped, it does — this is what the retry check operates on.
      const stripped = Bun.stripANSI(r.combined);
      expect(/error TS\d+/.test(stripped)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 130_000);

  test("incremental:false still reports the same errors", async () => {
    const dir = brokenProject();
    try {
      const r = await runTsc({ cwd: dir, incremental: false });
      expect(r.exitCode).not.toBe(0);
      expect(r.combined).toContain("TS2322");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 130_000);

  // The cache must never turn a broken project into a silent pass: run twice
  // against the same cwd and assert the warm run still reports the error.
  test("warm cache does not produce a false clean", async () => {
    const dir = brokenProject();
    try {
      const cold = await runTsc({ cwd: dir });
      const warm = await runTsc({ cwd: dir });
      expect(cold.combined).toContain("TS2322");
      expect(warm.combined).toContain("TS2322");
      expect(warm.exitCode).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 130_000);
});
