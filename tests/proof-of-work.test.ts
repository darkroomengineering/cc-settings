// Proof-of-work gate tests — pure detection/formatting only. The subprocess
// runner (runGate/runGates) is NOT exercised here: it would run `bun run test`,
// which re-enters this suite (recursion). Those paths are covered by running
// `bun run proof` manually.

import { describe, expect, test } from "bun:test";
import {
  allGreen,
  detectGates,
  detectReactDoctor,
  formatReport,
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
});
