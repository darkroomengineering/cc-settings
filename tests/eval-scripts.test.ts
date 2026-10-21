// Pure helpers and --help output of the skill-eval scripts. The scripts that
// call the paid `claude plugin eval` CLI are not run here.

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  aaRows,
  caseNoise,
  judgeFor,
  pairOrder,
  spread,
  withinNoise,
} from "../src/scripts/eval-ablate.ts";
import { classifyArms, flag, splitCost } from "../src/scripts/eval-changed.ts";

const SRC = resolve(import.meta.dir, "..", "src", "scripts");

async function help(script: string): Promise<{ exit: number; stdout: string }> {
  const proc = Bun.spawn(["bun", resolve(SRC, script), "--help"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  return { exit: await proc.exited, stdout };
}

describe("eval-changed", () => {
  test("--help lists --base-arm and exits 0 without running anything", async () => {
    const r = await help("eval-changed.ts");
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("--base-arm");
  });

  test("classifyArms labels each old/new combination at the threshold", () => {
    expect(classifyArms(0.5, 0.9, 0.8)).toBe("improvement");
    expect(classifyArms(0.9, 0.5, 0.8)).toBe("regression");
    expect(classifyArms(0.9, 0.95, 0.8)).toBe("no-regression-only");
    expect(classifyArms(0.4, 0.5, 0.8)).toBe("still-failing");
    expect(classifyArms(0.8, 0.8, 0.8)).toBe("no-regression-only");
  });

  test("the cost ceiling is split across both arms", () => {
    expect(splitCost("5", 2)).toBe("2.5");
    expect(splitCost("5", 1)).toBe("5");
  });

  test("flag reads the value after the name, else the fallback", () => {
    expect(flag("--base", "x", ["bun", "s", "--base", "main"])).toBe("main");
    expect(flag("--base", "x", ["bun", "s", "--base-arm"])).toBe("x");
  });
});

describe("eval-ablate", () => {
  test("judgeFor never returns the answer model", () => {
    expect(judgeFor("claude-sonnet-5-5")).toBe("claude-fable-5-1");
    expect(judgeFor("claude-fable-5-1")).toBe("claude-opus-5-5");
  });

  test("--help lists --aa and --noise and exits 0", async () => {
    const r = await help("eval-ablate.ts");
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("--aa");
    expect(r.stdout).toContain("--noise");
  });

  test("pairOrder alternates which arm runs first", () => {
    expect([0, 1, 2, 3].map((p) => pairOrder(p).join(""))).toEqual(["AB", "BA", "AB", "BA"]);
  });

  test("spread is max minus min, zero for no values", () => {
    expect(spread([0.2, 0.8, 0.5])).toBeCloseTo(0.6);
    expect(spread([])).toBe(0);
  });

  test("a delta is within noise only below the spread", () => {
    expect(withinNoise(0.1, 0.2)).toBe(true);
    expect(withinNoise(-0.1, 0.2)).toBe(true);
    expect(withinNoise(0.2, 0.2)).toBe(false);
    expect(withinNoise(0.1, null)).toBe(false);
  });

  test("aaRows stamps the arm and reports unlabeled cases and errors", () => {
    const report: Parameters<typeof aaRows>[3] = {
      cases: [
        {
          name: "c1",
          arms: {
            with: [
              { score: 1, costUsd: 0.1 },
              { score: 0, error: "boom" },
            ],
          },
        },
        { name: "c2", arms: {} },
      ],
    };
    const parsed = aaRows("B", 1, 2, report);
    expect(parsed.rows).toEqual([
      { arm: "B", pair: 1, position: 2, name: "c1", score: 1, costUsd: 0.1 },
    ]);
    expect(parsed.errored).toBe(1);
    expect(parsed.unlabeled).toEqual(["c2"]);
  });

  test("caseNoise reports score spread, arm gap and cost ratio per case", () => {
    const row = (arm: "A" | "B", score: number, costUsd: number) => ({
      arm,
      pair: 0,
      position: 1 as const,
      name: "c",
      score,
      costUsd,
    });
    const [n] = caseNoise([
      row("A", 1, 0.1),
      row("B", 0.5, 0.4),
      row("A", 1, 0.2),
      row("B", 0.5, 0.2),
    ]);
    expect(n?.scoreSpread).toBeCloseTo(0.5);
    expect(n?.armGap).toBeCloseTo(0.5);
    expect(n?.costRatio).toBeCloseTo(4);
    expect(n?.incomplete).toBe(false);
  });

  test("caseNoise marks a case incomplete when an arm lacks its expected runs", () => {
    const row = (arm: "A" | "B") => ({
      arm,
      pair: 0,
      position: 1 as const,
      name: "c",
      score: 1,
      costUsd: 0.1,
    });
    const [oneArm] = caseNoise([row("A"), row("A"), row("A")], 3);
    expect(oneArm?.scoreSpread).toBe(0);
    expect(oneArm?.incomplete).toBe(true);
    const [short] = caseNoise([row("A"), row("A"), row("B")], 2);
    expect(short?.incomplete).toBe(true);
    const [full] = caseNoise([row("A"), row("A"), row("B"), row("B")], 2);
    expect(full?.incomplete).toBe(false);
  });
});
