#!/usr/bin/env bun
// Checks that a skill still loads for the prompts it should match after its
// description changes, and stays out of near misses. Prompts come from
// evals/triggers/<skill>.json. It measures triggering only; it routes nothing.
//
// Each prompt runs through `claude -p` for one model turn with the Skill tool
// as the only tool and no MCP servers, and a run counts as triggered when that
// turn calls Skill with this skill. With the full tool set, an empty cwd makes
// the first move a Bash `ls` on every prompt, should and near miss alike, so
// the first turn says nothing about the description. Taking that option away
// biases every description version the same way, which is enough for a
// before/after check on a trim.
//
// It measures the INSTALLED skill (~/.claude/skills/<skill>), because a
// branch copy loaded with --plugin-dir is listed as `<plugin>:<skill>` next to
// the installed one and the two split the vote. Run setup.sh first; a
// description that differs from the branch copy skips the check.
//
// Exit 0: thresholds met. Exit 1: recall or false-trigger rate out of bounds,
// or a malformed prompt set. Exit 2: could not measure (no prompt set, unknown
// or uninstalled skill, stale install, missing CLI, cost ceiling hit before
// every run finished).

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { parseFrontmatter } from "../lib/frontmatter.ts";

const ROOT = join(import.meta.dir, "..", "..");
const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_RUNS = 3;
// Measured $1.13 for 20 runs on claude-sonnet-5-5 with caching off
// (2026-10-21), so 20 prompts x 3 runs is about $3.40 (est.).
export const DEFAULT_MAX_COST = 5;
const RUN_TIMEOUT_MS = 180_000;
const NO_MCP = JSON.stringify({ mcpServers: {} });

// Blocks every tool call before it runs, Skill included, so a forked skill
// never starts its subagent; the tool_use block is already in the stream.
const BLOCK_TOOLS = JSON.stringify({
  hooks: {
    PreToolUse: [
      {
        matcher: "",
        hooks: [{ type: "command", command: "echo 'trigger check: tools are off' >&2; exit 2" }],
      },
    ],
  },
});

export const HELP = `Usage: bun src/scripts/eval-triggers.ts <skill> [--runs <n>] [--max-cost-usd <n>] [--model <id>]

Runs the prompts in evals/triggers/<skill>.json through \`claude -p\` and scores
whether the installed skill loads: recall on "should", false-trigger rate on
"near_miss". Each run is one model turn with only the Skill tool and no MCP
servers. Run setup.sh first; it measures ~/.claude/skills/<skill>.

  --runs <n>           runs per prompt (default ${DEFAULT_RUNS})
  --max-cost-usd <n>   cost ceiling in USD (default ${DEFAULT_MAX_COST}); checked before each run, so the
                       overrun is bounded to one run
  --model <id>         model for the runs (default ${DEFAULT_MODEL})
  -h, --help           show this text`;

export const TriggerSet = z.strictObject({
  should: z.array(z.string().min(1)).min(1),
  near_miss: z.array(z.string().min(1)).min(1),
  min_recall: z.number().min(0).max(1),
  max_false_trigger: z.number().min(0).max(1),
});
export type TriggerSet = z.infer<typeof TriggerSet>;

export function triggerSetPath(skill: string, root = ROOT): string {
  return join(root, "evals", "triggers", `${skill}.json`);
}

/** The parsed prompt set, or a message saying why it is malformed. */
export function loadTriggerSet(path: string): TriggerSet | string {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return `${path} is not valid JSON: ${(err as Error).message}`;
  }
  const parsed = TriggerSet.safeParse(raw);
  return parsed.success
    ? parsed.data
    : `${path} is malformed: ${parsed.error.issues.map((i) => `[${i.path.join(".")}] ${i.message}`).join("; ")}`;
}

export function descriptionOf(md: string | null): string | null {
  if (md === null) return null;
  const front = parseFrontmatter(md) as { description?: unknown } | null;
  return typeof front?.description === "string" ? front.description : null;
}

/** True when the `description:` differs; a skill new on the branch counts as changed. */
export function descriptionChanged(oldMd: string | null, newMd: string | null): boolean {
  const now = descriptionOf(newMd);
  return now !== null && descriptionOf(oldMd) !== now;
}

export interface RunResult {
  /** Whether the init event listed the skill; null when no init event arrived. */
  loaded: boolean | null;
  triggered: boolean;
  /** Every skill the turn called, for the log. */
  called: string[];
  costUsd: number | null;
}

/** Reads a `claude -p --output-format stream-json --verbose` transcript. */
export function parseRun(stdout: string, skill: string): RunResult {
  const result: RunResult = { loaded: null, triggered: false, called: [], costUsd: null };
  const matches = (name: unknown) =>
    typeof name === "string" && (name === skill || name.endsWith(`:${skill}`));
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let event: {
      type?: string;
      subtype?: string;
      skills?: unknown;
      total_cost_usd?: unknown;
      message?: { content?: { type?: string; name?: string; input?: { skill?: unknown } }[] };
    };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "system" && event.subtype === "init" && Array.isArray(event.skills)) {
      result.loaded = event.skills.some(matches);
    } else if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if (block.type !== "tool_use" || block.name !== "Skill") continue;
        const name = block.input?.skill;
        if (typeof name === "string") result.called.push(name);
        if (matches(name)) result.triggered = true;
      }
    } else if (event.type === "result" && typeof event.total_cost_usd === "number") {
      result.costUsd = event.total_cost_usd;
    }
  }
  return result;
}

export type PromptKind = "should" | "near_miss";

export interface Graded {
  kind: PromptKind;
  prompt: string;
  triggered: boolean;
}

export interface TriggerScore {
  /** Share of "should" runs that loaded the skill; null with no graded runs. */
  recall: number | null;
  /** Share of "near_miss" runs that loaded the skill; null with no graded runs. */
  falseTrigger: number | null;
}

export function scoreTriggers(graded: Graded[]): TriggerScore {
  const rate = (kind: PromptKind) => {
    const runs = graded.filter((g) => g.kind === kind);
    return runs.length === 0 ? null : runs.filter((g) => g.triggered).length / runs.length;
  };
  return { recall: rate("should"), falseTrigger: rate("near_miss") };
}

/** Alternates the two kinds so a run cut short by the ceiling still covers both. */
export function interleave(set: TriggerSet): { kind: PromptKind; prompt: string }[] {
  const out: { kind: PromptKind; prompt: string }[] = [];
  for (let i = 0; i < Math.max(set.should.length, set.near_miss.length); i++) {
    const s = set.should[i];
    const n = set.near_miss[i];
    if (s !== undefined) out.push({ kind: "should", prompt: s });
    if (n !== undefined) out.push({ kind: "near_miss", prompt: n });
  }
  return out;
}

export interface TriggerOutcome {
  status: "pass" | "fail" | "skipped";
  reason: string;
  costUsd: number;
}

interface CheckOptions {
  skill: string;
  runs: number;
  maxCost: number;
  model: string;
  root?: string;
  log?: (line: string) => void;
}

export function checkTriggers(opts: CheckOptions): TriggerOutcome {
  const root = opts.root ?? ROOT;
  const log = opts.log ?? ((line: string) => console.error(line));
  const skip = (reason: string, costUsd = 0): TriggerOutcome => ({
    status: "skipped",
    reason,
    costUsd,
  });

  const setPath = triggerSetPath(opts.skill, root);
  if (!existsSync(setPath)) return skip(`no prompt set at evals/triggers/${opts.skill}.json`);
  const set = loadTriggerSet(setPath);
  if (typeof set === "string") return { status: "fail", reason: set, costUsd: 0 };

  const branch = join(root, "skills", opts.skill, "SKILL.md");
  if (!existsSync(branch)) return skip(`no skill named ${opts.skill} under skills/`);
  const installed = join(homedir(), ".claude", "skills", opts.skill, "SKILL.md");
  if (!existsSync(installed)) return skip(`${opts.skill} is not installed; run setup.sh`);
  const branchDescription = descriptionOf(readFileSync(branch, "utf8"));
  if (descriptionOf(readFileSync(installed, "utf8")) !== branchDescription) {
    return skip("the installed description differs from the branch; run setup.sh, then rerun");
  }
  if (!Bun.which("claude")) return skip("claude CLI not found");

  const env = { ...process.env };
  // Claude Code refuses to start inside another session while this is set.
  delete env.CLAUDECODE;
  // Claude Code sends the prompt before the skill listing and hook context, and
  // caches only at the end of the system prompt and the message, so every new
  // prompt rewrites ~23k tokens that are never read back. Uncached input costs
  // about 20% less per prompt set ($1.13 vs $1.42 per 20 runs, 2026-10-21).
  env.DISABLE_PROMPT_CACHING = "1";
  const graded: Graded[] = [];
  let spent = 0;
  let errored = 0;
  let cut = false;
  const plan = interleave(set);
  const cwd = mkdtempSync(join(tmpdir(), "cc-settings-triggers-"));
  try {
    outer: for (let r = 0; r < opts.runs; r++) {
      for (const { kind, prompt } of plan) {
        if (spent >= opts.maxCost) {
          cut = true;
          break outer;
        }
        const proc = Bun.spawnSync({
          cmd: [
            "claude",
            "-p",
            prompt,
            "--output-format",
            "stream-json",
            "--verbose",
            "--max-turns",
            "1",
            "--no-session-persistence",
            "--model",
            opts.model,
            "--settings",
            BLOCK_TOOLS,
            "--tools",
            "Skill",
            "--strict-mcp-config",
            "--mcp-config",
            NO_MCP,
            "--max-budget-usd",
            (opts.maxCost - spent).toFixed(4),
          ],
          cwd,
          env,
          stdout: "pipe",
          stderr: "pipe",
          timeout: RUN_TIMEOUT_MS,
        });
        const run = parseRun(new TextDecoder().decode(proc.stdout), opts.skill);
        spent += run.costUsd ?? 0;
        if (run.loaded === false) {
          return skip(`claude -p did not list ${opts.skill} among its skills`, spent);
        }
        if (run.costUsd === null) {
          errored++;
          log(`  error  ${kind}  ${prompt.slice(0, 70)}`);
          continue;
        }
        graded.push({ kind, prompt, triggered: run.triggered });
        const hit = kind === "should" ? run.triggered : !run.triggered;
        const what = run.called.length > 0 ? run.called.join(",") : "text only";
        log(
          `  ${hit ? "ok  " : "MISS"}  ${kind.padEnd(9)}  ${what.padEnd(16)}  ${prompt.slice(0, 60)}`,
        );
      }
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  const { recall, falseTrigger } = scoreTriggers(graded);
  const pct = (n: number | null) => (n === null ? "n/a" : `${(n * 100).toFixed(0)}%`);
  log(
    `  ${opts.skill}: recall ${pct(recall)} (min ${pct(set.min_recall)}), ` +
      `false triggers ${pct(falseTrigger)} (max ${pct(set.max_false_trigger)}), ` +
      `${graded.length} graded, ${errored} errored, cost $${spent.toFixed(2)}`,
  );
  if (cut) return skip(`cost ceiling $${opts.maxCost} hit before every run finished`, spent);
  // Scoring only the runs that returned would overstate recall or hide false triggers.
  if (errored > 0)
    return skip(`${errored} run(s) errored; rerun before trusting the scores`, spent);
  if (recall === null || falseTrigger === null) return skip("no graded runs in one class", spent);
  const failures = [
    recall < set.min_recall ? `recall ${pct(recall)} < ${pct(set.min_recall)}` : null,
    falseTrigger > set.max_false_trigger
      ? `false triggers ${pct(falseTrigger)} > ${pct(set.max_false_trigger)}`
      : null,
  ].filter((f): f is string => f !== null);
  return failures.length > 0
    ? { status: "fail", reason: failures.join(", "), costUsd: spent }
    : { status: "pass", reason: "thresholds met", costUsd: spent };
}

export function positiveNumber(name: string, value: string, integer: boolean): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) {
    throw new Error(`${name} must be a positive ${integer ? "integer" : "number"}, got "${value}"`);
  }
  return n;
}

function main(): never {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    console.log(HELP);
    process.exit(argv.length === 0 ? 2 : 0);
  }
  const value = (name: string, fallback: string) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : fallback;
  };
  const skill = argv[0] as string;
  let runs: number;
  let maxCost: number;
  try {
    runs = positiveNumber("--runs", value("--runs", String(DEFAULT_RUNS)), true);
    maxCost = positiveNumber(
      "--max-cost-usd",
      value("--max-cost-usd", String(DEFAULT_MAX_COST)),
      false,
    );
  } catch (err) {
    console.error(`[eval-triggers] ${(err as Error).message}`);
    process.exit(2);
  }
  const outcome = checkTriggers({ skill, runs, maxCost, model: value("--model", DEFAULT_MODEL) });
  console.error(`[eval-triggers] ${skill}: ${outcome.status}, ${outcome.reason}`);
  process.exit(outcome.status === "pass" ? 0 : outcome.status === "fail" ? 1 : 2);
}

if (import.meta.main) main();
