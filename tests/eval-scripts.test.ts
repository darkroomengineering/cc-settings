// Pure helpers and --help output of the skill-eval scripts. The scripts that
// call the paid `claude plugin eval` CLI are not run here.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type CaseRuns,
  gate,
  parseQuarantine,
  QuarantineFile,
  removedCases,
} from "../src/lib/eval-gate.ts";
import {
  aaRows,
  caseNoise,
  judgeFor,
  pairOrder,
  spread,
  withinNoise,
} from "../src/scripts/eval-ablate.ts";
import { caseRuns, classifyArms, flag, splitCost } from "../src/scripts/eval-changed.ts";
import {
  checkTriggers,
  descriptionChanged,
  interleave,
  loadTriggerSet,
  parseRun,
  scoreTriggers,
} from "../src/scripts/eval-triggers.ts";

const ROOT = resolve(import.meta.dir, "..");
const SRC = resolve(ROOT, "src", "scripts");

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

describe("eval-changed gate", () => {
  const runs = (score: number, ...perRun: number[]): CaseRuns => ({
    score,
    runs: perRun.length > 0 ? perRun : [score],
  });
  const input = (over: Partial<Parameters<typeof gate>[0]> = {}): Parameters<typeof gate>[0] => ({
    candidate: new Map(),
    base: null,
    critical: new Set(),
    removed: [],
    quarantine: new Map(),
    threshold: 0.8,
    ...over,
  });
  const rules = (v: ReturnType<typeof gate>) => v.map((x) => `${x.rule}:${x.case}`);
  const entry = (name: string, expires = "2099-01-01") => ({
    case: name,
    owner: "frz",
    expires,
    reason: "flaky judge",
  });

  test("--help lists --runs, --triggers and the critical tag", async () => {
    const r = await help("eval-changed.ts");
    expect(r.stdout).toContain("--runs");
    expect(r.stdout).toContain("--triggers");
    expect(r.stdout).toContain("critical");
  });

  test("a case below the threshold blocks; one at the threshold passes", () => {
    const v = gate(
      input({
        candidate: new Map([
          ["a", runs(0.5)],
          ["b", runs(0.8)],
        ]),
      }),
    );
    expect(rules(v)).toEqual(["below-threshold:a"]);
    expect(v[0]?.quarantined).toBe(false);
  });

  test("a critical case that passed every base run and failed one candidate run blocks", () => {
    const v = gate(
      input({
        candidate: new Map([["c", runs(0.83, 1, 1, 0.5)]]),
        base: new Map([["c", runs(1, 1, 1, 1)]]),
        critical: new Set(["c"]),
      }),
    );
    expect(rules(v)).toEqual(["critical-regression:c"]);
    expect(v[0]?.detail).toContain("failed 1/3 candidate runs");
  });

  test("the critical rule needs a clean base, the critical tag, and a base arm", () => {
    const candidate = new Map([["c", runs(0.83, 1, 1, 0.5)]]);
    const critical = new Set(["c"]);
    const noisyBase = gate(
      input({ candidate, base: new Map([["c", runs(0.83, 1, 0.5, 1)]]), critical }),
    );
    expect(noisyBase).toEqual([]);
    const notCritical = gate(input({ candidate, base: new Map([["c", runs(1, 1, 1, 1)]]) }));
    expect(notCritical).toEqual([]);
    expect(gate(input({ candidate, critical }))).toEqual([]);
    const baseErrored = gate(
      input({ candidate, base: new Map([["c", { score: 0, runs: [] }]]), critical }),
    );
    expect(baseErrored).toEqual([]);
  });

  test("a removed case blocks as missing-case", () => {
    expect(rules(gate(input({ removed: ["gone"] })))).toEqual(["missing-case:gone"]);
  });

  test("a quarantined case still gets its verdict, marked quarantined", () => {
    const v = gate(
      input({
        candidate: new Map([["flaky", runs(0)]]),
        removed: ["gone"],
        quarantine: new Map([
          ["flaky", entry("flaky")],
          ["gone", entry("gone")],
        ]),
      }),
    );
    expect(v.map((x) => x.quarantined)).toEqual([true, true]);
  });

  test("removedCases flags deleted, renamed and untagged cases of changed skills only", () => {
    const base: Array<[string, string[]]> = [
      ["fix-deleted", ["fix"]],
      ["fix-old-name", ["fix", "critical"]],
      ["fix-untagged", ["fix"]],
      ["fix-kept", ["fix"]],
      ["ship-deleted", ["ship"]],
    ];
    const current = new Map([
      ["fix-new-name", ["fix", "critical"]],
      ["fix-untagged", ["refactor"]],
      ["fix-kept", ["fix"]],
    ]);
    expect(removedCases(base, current, new Set(["fix"]))).toEqual([
      "fix-deleted",
      "fix-old-name",
      "fix-untagged",
    ]);
    expect(removedCases(base, current, new Set(["refactor"]))).toEqual([]);
  });

  test("caseRuns reads per-run scores, drops errored runs, falls back to the aggregate", () => {
    const parsed = caseRuns({
      cases: [
        {
          name: "a",
          aggregates: { score: 0.5 },
          arms: { with: [{ score: 1, error: null }, { score: 0, error: "timeout" }, { score: 0 }] },
        },
        { name: "b", aggregates: { score: 0.9 } },
      ],
    });
    expect(parsed.get("a")).toEqual({ score: 0.5, runs: [1, 0] });
    expect(parsed.get("b")).toEqual({ score: 0.9, runs: [0.9] });
  });
});

describe("eval-changed quarantine", () => {
  const ok = { case: "c", owner: "frz", expires: "2026-10-21", reason: "flaky judge" };

  test("an entry is in force through its expiry date", () => {
    const q = parseQuarantine([ok], "2026-10-21");
    expect(q.problems).toEqual([]);
    expect(q.active.get("c")?.owner).toBe("frz");
  });

  test("an expired entry is a problem that names the case and owner", () => {
    const q = parseQuarantine([ok], "2026-10-22");
    expect(q.active.size).toBe(0);
    expect(q.problems).toHaveLength(1);
    expect(q.problems[0]).toContain("c (owner frz) expired 2026-10-21");
  });

  test.each([
    ["no owner", { case: "c", expires: "2099-01-01", reason: "r" }],
    ["impossible date", { ...ok, expires: "2026-02-30" }],
    ["wrong date format", { ...ok, expires: "21/10/2026" }],
    ["unknown field", { ...ok, ticket: "OSS-37" }],
    ["empty reason", { ...ok, reason: "" }],
  ])("a malformed entry (%s) is a problem", (_label, bad) => {
    const q = parseQuarantine([bad], "2026-01-01");
    expect(q.problems.length).toBeGreaterThan(0);
    expect(q.problems[0]).toContain("malformed");
  });

  test("a non-array file and a duplicate entry are problems", () => {
    expect(parseQuarantine({ c: ok }, "2026-01-01").problems.length).toBeGreaterThan(0);
    expect(parseQuarantine([ok, ok], "2026-01-01").problems).toEqual([
      "duplicate quarantine entry for c",
    ]);
  });

  test("the checked-in evals/quarantine.json matches the schema", () => {
    const raw = JSON.parse(readFileSync(join(ROOT, "evals", "quarantine.json"), "utf8"));
    expect(QuarantineFile.safeParse(raw).success).toBe(true);
  });
});

describe("eval-triggers", () => {
  const lines = (...events: object[]) => events.map((e) => JSON.stringify(e)).join("\n");
  const init = (skills: string[]) => ({
    type: "system",
    subtype: "init",
    skills,
    tools: ["Skill"],
  });
  const skillCall = (skill: string) => ({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "toolu_1", name: "Skill", input: { skill, args: "x" } }],
    },
    parent_tool_use_id: null,
  });
  const result = {
    type: "result",
    subtype: "error_max_turns",
    is_error: true,
    total_cost_usd: 0.108,
  };

  test("--help exits 0 and names the prompt set", async () => {
    const r = await help("eval-triggers.ts");
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("evals/triggers/<skill>.json");
  });

  test("parseRun counts a Skill call naming the skill as triggered", () => {
    const run = parseRun(lines(init(["fix", "refactor"]), skillCall("fix"), result), "fix");
    expect(run).toEqual({ loaded: true, triggered: true, called: ["fix"], costUsd: 0.108 });
  });

  test("parseRun matches a plugin-namespaced skill", () => {
    const run = parseRun(lines(init(["cc-settings:fix"]), skillCall("cc-settings:fix")), "fix");
    expect(run.loaded).toBe(true);
    expect(run.triggered).toBe(true);
    expect(run.costUsd).toBeNull();
  });

  test("parseRun does not count another skill, another tool, or a text turn", () => {
    const other = parseRun(lines(init(["fix", "refactor"]), skillCall("refactor"), result), "fix");
    expect(other).toMatchObject({ triggered: false, called: ["refactor"] });
    const bash = {
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] },
    };
    expect(parseRun(lines(init(["fix"]), bash, result), "fix").triggered).toBe(false);
    const text = {
      type: "assistant",
      message: { content: [{ type: "text", text: "Here is how" }] },
    };
    expect(parseRun(lines(init(["fix"]), text, result), "fix")).toMatchObject({
      triggered: false,
      called: [],
    });
    expect(parseRun(lines(init(["fixer"]), skillCall("fixer")), "fix").triggered).toBe(false);
  });

  test("parseRun reports a skill missing from init and skips junk lines", () => {
    const run = parseRun(`not json\n\n${lines(init(["refactor"]), result)}`, "fix");
    expect(run.loaded).toBe(false);
    expect(run.costUsd).toBe(0.108);
    expect(parseRun("", "fix").loaded).toBeNull();
  });

  test("descriptionChanged compares only the description field", () => {
    const md = (description: string, body = "# Body") =>
      `---\nname: fix\ndescription: ${description}\n---\n\n${body}\n`;
    expect(descriptionChanged(md("Debug a defect."), md("Debug a defect.", "# Other"))).toBe(false);
    expect(descriptionChanged(md("Debug a defect."), md("Debug defects."))).toBe(true);
    expect(descriptionChanged(null, md("New skill."))).toBe(true);
    expect(descriptionChanged(md("Gone."), null)).toBe(false);
    expect(descriptionChanged(md("x"), "no frontmatter")).toBe(false);
  });

  test("scoreTriggers reports recall and false-trigger rate, null for an empty class", () => {
    const s = scoreTriggers([
      { kind: "should", prompt: "a", triggered: true },
      { kind: "should", prompt: "b", triggered: false },
      { kind: "near_miss", prompt: "c", triggered: false },
      { kind: "near_miss", prompt: "d", triggered: true },
      { kind: "near_miss", prompt: "e", triggered: false },
      { kind: "near_miss", prompt: "f", triggered: false },
    ]);
    expect(s).toEqual({ recall: 0.5, falseTrigger: 0.25 });
    const oneClass = scoreTriggers([{ kind: "should", prompt: "a", triggered: true }]);
    expect(oneClass.falseTrigger).toBeNull();
  });

  test("interleave alternates the two kinds and keeps every prompt", () => {
    const plan = interleave({
      should: ["s1", "s2", "s3"],
      near_miss: ["n1"],
      min_recall: 0.5,
      max_false_trigger: 0.2,
    });
    expect(plan.map((p) => p.prompt)).toEqual(["s1", "n1", "s2", "s3"]);
  });

  test("every checked-in prompt set parses and names an existing skill", () => {
    const dir = join(ROOT, "evals", "triggers");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const set = loadTriggerSet(join(dir, file));
      expect(typeof set === "string" ? set : "ok").toBe("ok");
      expect(readdirSync(join(ROOT, "skills"))).toContain(file.replace(/\.json$/, ""));
    }
  });

  test("checkTriggers skips without a prompt set and fails a malformed one, with no runs", () => {
    const root = mkdtempSync(join(tmpdir(), "cc-settings-triggers-test-"));
    const opts = { skill: "fix", runs: 1, maxCost: 0.01, model: "m", root, log: () => {} };
    try {
      expect(checkTriggers(opts)).toMatchObject({ status: "skipped", costUsd: 0 });
      mkdirSync(join(root, "evals", "triggers"), { recursive: true });
      writeFileSync(join(root, "evals", "triggers", "fix.json"), JSON.stringify({ should: [] }));
      const bad = checkTriggers(opts);
      expect(bad.status).toBe("fail");
      expect(bad.reason).toContain("malformed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
