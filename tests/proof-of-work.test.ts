// Proof-of-work gate tests — pure detection/formatting only. The subprocess
// runner (runGate/runGates) is NOT exercised here: it would run `bun run test`,
// which re-enters this suite (recursion). Those paths are covered by running
// `bun run proof` manually.

import { describe, expect, test } from "bun:test";
import { allGreen, detectGates, formatReport } from "../src/lib/proof-of-work.ts";

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
});
