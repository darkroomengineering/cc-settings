// Proof-of-work gate tests — pure detection/formatting, plus runGate exercised
// against disposable fixture projects (never this repo's own `bun run test`,
// which would recurse into this suite).

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allGreen,
  detectDeslop,
  detectGates,
  detectReactDoctor,
  formatReport,
  runGate,
  sumDeslopFindings,
  tailOutput,
} from "../src/lib/proof-of-work.ts";

describe("proof-of-work lib", () => {
  test("detectGates: picks runnable gates, cheapest-first", () => {
    expect(detectGates({ typecheck: "tsc", test: "bun test", lint: "biome check ." })).toEqual([
      "typecheck",
      "test",
      "lint",
    ]);
    expect(detectGates({ test: "bun test" })).toEqual(["test"]);
    expect(detectGates({ build: "x", format: "y" })).toEqual([]);
  });

  test("allGreen: green unless a gate failed (skips ok)", () => {
    expect(
      allGreen([
        { gate: "typecheck", status: "pass" },
        { gate: "lint", status: "skip" },
      ]),
    ).toBe(true);
    expect(allGreen([{ gate: "test", status: "fail" }])).toBe(false);
    expect(allGreen([])).toBe(true);
  });

  test("formatReport: verdict reflects pass/fail", () => {
    expect(formatReport([{ gate: "typecheck", status: "pass" }])).toContain("review-ready ✓");
    expect(formatReport([{ gate: "test", status: "fail" }])).toContain("NOT review-ready");
  });

  test("detectReactDoctor: true only when react-doctor is a dependency", () => {
    expect(detectReactDoctor({ "react-doctor": "0.2.16", react: "19" })).toBe(true);
    expect(detectReactDoctor({ react: "19", "react-dom": "19" })).toBe(false);
    expect(detectReactDoctor({})).toBe(false);
  });

  test("allGreen: advisory probes never flip the verdict", () => {
    expect(
      allGreen([
        { gate: "typecheck", status: "pass" },
        { gate: "react-doctor", status: "skip", advisory: true },
      ]),
    ).toBe(true);
    // even a non-pass advisory status is non-blocking
    expect(allGreen([{ gate: "react-doctor", status: "fail", advisory: true }])).toBe(true);
  });

  test("formatReport: advisory entries render with ℹ and an (advisory) tag", () => {
    const report = formatReport([
      { gate: "typecheck", status: "pass" },
      { gate: "react-doctor", status: "pass", detail: "score 87/100", advisory: true },
    ]);
    expect(report).toContain("ℹ react-doctor — score 87/100 (advisory)");
    expect(report).toContain("review-ready ✓");
  });

  test("detectDeslop: true only when deslop-cli is a dependency", () => {
    expect(detectDeslop({ "deslop-cli": "0.0.14", typescript: "6" })).toBe(true);
    // deslop-js (the lib) is not the bin package — only deslop-cli counts
    expect(detectDeslop({ "deslop-js": "0.0.14" })).toBe(false);
    expect(detectDeslop({})).toBe(false);
  });

  test("sumDeslopFindings: sums finding arrays, ignores scalar metadata", () => {
    const report = JSON.stringify({
      unusedFiles: [{ path: "a" }, { path: "b" }],
      unusedExports: [{ name: "x" }],
      circularDependencies: [],
      totalFiles: 120,
      analysisTimeMs: 42,
    });
    expect(sumDeslopFindings(report)).toBe(3);
    expect(sumDeslopFindings("{}")).toBe(0);
    expect(sumDeslopFindings("not json")).toBeNull();
  });

  test("deslop advisory: rendered with (advisory), never blocks the verdict", () => {
    const results = [
      { gate: "typecheck" as const, status: "pass" as const },
      { gate: "deslop" as const, status: "pass" as const, detail: "12 findings", advisory: true },
    ];
    expect(allGreen(results)).toBe(true);
    expect(formatReport(results)).toContain("ℹ deslop — 12 findings (advisory)");
  });

  test("tailOutput: keeps only the last N non-empty lines, trimmed", () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}  `).join("\n");
    const tail = tailOutput(text, 3);
    expect(tail).toBe("line 17\nline 18\nline 19");
  });

  test("tailOutput: drops blank lines and handles short input unchanged", () => {
    expect(tailOutput("a\n\n\nb\n", 5)).toBe("a\nb");
    expect(tailOutput("", 5)).toBe("");
  });
});

// M20 regression: a failing gate must carry a `detail` tail of its actual
// stdout/stderr output, not a bare pass/fail — otherwise a red proof-of-work
// verdict gives zero clue what broke without a separate manual re-run.
describe("runGate (subprocess)", () => {
  async function makeFixture(scriptBody: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "cc-proof-gate-"));
    await writeFile(join(dir, "fail.js"), scriptBody);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { typecheck: "bun fail.js" } }),
    );
    return dir;
  }

  test("failing gate captures a tail of its stderr as detail", async () => {
    const dir = await makeFixture(
      `console.log("noise");\nconsole.error("boom: something broke");\nprocess.exit(1);\n`,
    );
    try {
      const result = await runGate("typecheck", dir);
      expect(result.status).toBe("fail");
      expect(result.detail).toContain("boom: something broke");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("passing gate has no detail", async () => {
    const dir = await makeFixture(`process.exit(0);\n`);
    try {
      const result = await runGate("typecheck", dir);
      expect(result.status).toBe("pass");
      expect(result.detail).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
