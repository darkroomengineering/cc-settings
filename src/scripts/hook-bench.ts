#!/usr/bin/env bun
// `bun run hooks:bench` — replays each synchronous command hook in
// config/40-hooks.json with a representative stdin payload, N times, and
// reports wall-clock p50/p95 per hook plus per-event totals.
//
// Isolation: every hook runs with HOME pointed at a throwaway directory whose
// `.claude/src` is a symlink to this repo's src/, so the real command string
// (`bun "$HOME/.claude/src/hooks/x.ts"`) runs unchanged while all state,
// logs and caches land in the temp HOME. Only read-only inputs are copied in
// (knowledge index, rate-limit cache, codex verdict). The bench refuses to
// finish quietly if the repo's `git status` changed. Hooks that would spawn
// tsc/proof/push, start daemons, or touch the network are skipped and listed.
//
// What it measures: process spawn through `sh -c`, Bun start, module load
// and the hook's work, on the payload below. It does not measure Claude
// Code's own dispatch overhead, or the Jev HTTP call in delegation-detector
// (no TYPESAFE_API_KEY is visible to the child).

import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hooksConfigPath,
  loadHookEntries,
  matchesTool,
  median,
  percentile,
} from "../lib/hook-frequency.ts";
import { claudePath } from "../lib/platform.ts";

const USAGE = `Usage: hook-bench [--runs N] [--warmup N] [--json]
  --runs N     measured runs per hook (default 30)
  --warmup N   discarded runs per hook before measuring (default 3)
  --json       machine-readable report`;

const SKIP: Record<string, string> = {
  "pre-commit-tsc": "if-filtered to git commit; spawns tsc against the working tree",
  "pre-commit-farolero": "if-filtered to git commit; spawns checks against the working tree",
  "pre-pr-proof": "if-filtered to gh pr create/ready; runs bun run proof (minutes)",
  "pre-push-proof": "if-filtered to git push; runs proof and would contact the remote",
  "verify-hooks": "needs the installed src manifest and hashes the install tree; once per session",
  "session-start":
    "starts the code-intel daemon, a gh knowledge refresh and an MCP prune; once per session",
  "handoff create --from-hook": "git-bound, writes handoff files; once per compaction",
};

const SESSION = "00000000-0000-4000-8000-000000000001";

interface Variant {
  /** Tool the payload represents; also selects which matchers it satisfies. */
  tool?: string;
  payload: Record<string, unknown>;
  /** Run in the temp work dir instead of the repo (hooks that rewrite files). */
  cwdWork?: boolean;
}

function buildCases(work: string, sample: string, transcript: string): Record<string, Variant[]> {
  const base = {
    session_id: SESSION,
    transcript_path: transcript,
    cwd: "",
    permission_mode: "default",
  };
  const pre = (tool: string, input: Record<string, unknown>): Variant => ({
    tool,
    payload: {
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: input,
      tool_use_id: "toolu_bench",
    },
  });
  const post = (
    tool: string,
    input: Record<string, unknown>,
    extra: Partial<Variant> = {},
  ): Variant => ({
    tool,
    payload: {
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: tool,
      tool_input: input,
      tool_response: { success: true },
      tool_use_id: "toolu_bench",
    },
    ...extra,
  });
  const edit = {
    file_path: sample,
    old_string: 'const TMP_DIR = claudePath("tmp");',
    new_string: 'const TMP_DIR = claudePath("tmp2");',
  };
  const write = { file_path: join(work, "new-file.ts"), content: "export const x = 1;\n" };
  const prompt =
    "Can you look at why the settings merge drops the permissions block when a project overrides it, and tell me which function is responsible before we change anything?";
  return {
    "delegation-detector": [{ payload: { ...base, hook_event_name: "UserPromptSubmit", prompt } }],
    "quota-steer": [{ payload: { ...base, hook_event_name: "UserPromptSubmit", prompt } }],
    "escalate-model": [{ payload: { ...base, hook_event_name: "UserPromptSubmit", prompt } }],
    "model-switch-guard": [
      {
        payload: {
          ...base,
          hook_event_name: "PreModelSwitch",
          to_model: "claude-fable-5-1",
          from_model: "claude-opus-5-5",
        },
      },
    ],
    "safety-net": [pre("Bash", { command: "bun run typecheck" })],
    "pre-edit-validate": [pre("Edit", edit)],
    "freeze-guard": [pre("Edit", edit), pre("Write", write)],
    "knowledge-hint": [
      pre("Edit", edit),
      pre("Write", write),
      pre("Bash", { command: "bun run typecheck" }),
    ],
    "check-docs-before-install": [pre("Bash", { command: "bun add zod" })],
    "post-edit": [post("Edit", edit, { cwdWork: true })],
    "tool-cadence": [post("Bash", { command: "ls src" })],
    "promote-memory": [post("Edit", edit)],
    "escalate-acted": [post("Agent", { subagent_type: "explore", prompt: "map the repo" })],
    "post-failure": [
      {
        tool: "Bash",
        payload: {
          ...base,
          hook_event_name: "PostToolUseFailure",
          tool_name: "Bash",
          tool_input: { command: "bun run nope" },
          error: "Command exited with non-zero status code 1",
          tool_use_id: "toolu_bench",
        },
      },
    ],
    "stop-summary": [{ payload: { ...base, hook_event_name: "Stop", stop_hook_active: false } }],
    "ask-gate": [
      {
        payload: {
          ...base,
          hook_event_name: "Stop",
          stop_hook_active: false,
          last_assistant_message: "Done. The change is in place.",
        },
      },
    ],
    "stop-failure": [
      {
        payload: {
          ...base,
          hook_event_name: "StopFailure",
          error: "rate_limit",
          error_details: "bench",
        },
      },
    ],
    "post-compact": [
      {
        payload: {
          ...base,
          hook_event_name: "PostCompact",
          trigger: "manual",
          compact_summary: "bench",
        },
      },
    ],
  };
}

// ── Sandbox ──────────────────────────────────────────────────────────────────

interface Sandbox {
  home: string;
  work: string;
  sample: string;
  transcript: string;
  cleanup: () => Promise<void>;
}

async function makeSandbox(repoRoot: string): Promise<Sandbox> {
  const home = await mkdtemp(join(tmpdir(), "hook-bench-"));
  const work = join(home, "work");
  await mkdir(join(home, ".claude", "tmp"), { recursive: true });
  await mkdir(work, { recursive: true });
  await symlink(join(repoRoot, "src"), join(home, ".claude", "src"));
  // Read-only copies of the state the hooks read, so they take their usual
  // path instead of the "cache missing" early exit.
  for (const name of ["knowledge-index.json", "rate-limits.json", "codex-verdict.json"]) {
    const from = claudePath("tmp", name);
    if (existsSync(from)) await copyFile(from, join(home, ".claude", "tmp", name));
  }
  const sample = join(work, "sample.ts");
  await copyFile(join(repoRoot, "src", "lib", "hook-runtime.ts"), sample);
  const transcript = join(work, "transcript.jsonl");
  const lines = Array.from({ length: 200 }, (_, i) =>
    JSON.stringify({ type: i % 2 ? "assistant" : "user", message: { content: `line ${i}` } }),
  );
  await writeFile(transcript, `${lines.join("\n")}\n`);
  await writeFile(join(home, "noop.ts"), "");
  return {
    home,
    work,
    sample,
    transcript,
    cleanup: () => rm(home, { recursive: true, force: true }),
  };
}

function childEnv(
  sb: Sandbox,
  repoRoot: string,
  payload: Record<string, unknown>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === "TYPESAFE_API_KEY" || k === "CC_SETTINGS_HOME" || k.startsWith("CLAUDE")) continue;
    if (k.startsWith("TOOL_") || k === "PROMPT") continue;
    env[k] = v;
  }
  env.HOME = sb.home;
  env.CLAUDE_PROJECT_DIR = repoRoot;
  env.CLAUDE_SESSION_ID = SESSION;
  env.CLAUDE_CODE_SESSION_ID = SESSION;
  // Hooks fall back to these when stdin carries no field; real Claude Code
  // sets the TOOL_* variables for tool events.
  const input = payload.tool_input as Record<string, unknown> | undefined;
  if (typeof payload.tool_name === "string") env.TOOL_NAME = payload.tool_name;
  if (input) {
    env.TOOL_INPUT = JSON.stringify(input);
    for (const [k, v] of Object.entries(input)) {
      env[`TOOL_INPUT_${k}`] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  if (typeof payload.prompt === "string") env.PROMPT = payload.prompt;
  return env;
}

interface Sample {
  ms: number;
  exit: number;
  stdoutBytes: number;
}

async function runOnce(
  command: string,
  env: Record<string, string>,
  cwd: string,
  stdin: string,
): Promise<Sample> {
  const t0 = performance.now();
  const proc = Bun.spawn(["/bin/sh", "-c", command], {
    cwd,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(stdin);
  proc.stdin.end();
  const [out, , exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ms: performance.now() - t0, exit, stdoutBytes: out.length };
}

// ── Report ───────────────────────────────────────────────────────────────────

export interface BenchRow {
  id: string;
  event: string;
  matcher: string | null;
  tool?: string;
  runs: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  mean: number;
  exitCodes: Record<string, number>;
  /** Runs that printed to stdout (advisory or block output). */
  withOutput: number;
}

const SCENARIOS: { label: string; event: string; tool: string | null }[] = [
  { label: "PreToolUse Edit", event: "PreToolUse", tool: "Edit" },
  { label: "PreToolUse Write", event: "PreToolUse", tool: "Write" },
  { label: "PreToolUse Bash", event: "PreToolUse", tool: "Bash" },
  { label: "PostToolUse Edit", event: "PostToolUse", tool: "Edit" },
  { label: "PostToolUse Bash", event: "PostToolUse", tool: "Bash" },
  { label: "PostToolUse Agent", event: "PostToolUse", tool: "Agent" },
  { label: "UserPromptSubmit", event: "UserPromptSubmit", tool: null },
  { label: "Stop", event: "Stop", tool: null },
];

async function gitState(repoRoot: string): Promise<string> {
  const p = Bun.spawn(["git", "-C", repoRoot, "status", "--porcelain", "--ignored"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let runs = 30;
  let warmup = 3;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === "--json") json = true;
    else if (argv[i] === "--runs" && v && /^[1-9]\d*$/.test(v)) runs = Number(argv[++i]);
    else if (argv[i] === "--warmup" && v && /^\d+$/.test(v)) warmup = Number(argv[++i]);
    else {
      console.error(USAGE);
      process.exit(1);
    }
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const entries = await loadHookEntries(hooksConfigPath(repoRoot));
  const before = await gitState(repoRoot);
  const sb = await makeSandbox(repoRoot);
  const cases = buildCases(sb.work, sb.sample, sb.transcript);
  const rows: BenchRow[] = [];
  const skipped: { id: string; event: string; reason: string }[] = [];
  let sandboxFiles: string[] = [];

  try {
    // Process-start floor: the same sh + bun spawn running an empty script.
    const floorEnv = childEnv(sb, repoRoot, {});
    const floorCmd = `bun "$HOME/noop.ts"`;
    const floorMs: number[] = [];
    for (let i = 0; i < warmup + runs; i++) {
      const s = await runOnce(floorCmd, floorEnv, repoRoot, "{}");
      if (i >= warmup) floorMs.push(s.ms);
    }

    const tested = new Set<string>();
    for (const e of entries) {
      if (e.async) {
        skipped.push({ id: e.id, event: e.event, reason: "async: never blocks" });
        continue;
      }
      const skip = SKIP[e.id];
      if (skip) {
        skipped.push({ id: e.id, event: e.event, reason: skip });
        continue;
      }
      const variants = cases[e.id];
      if (!variants) {
        skipped.push({ id: e.id, event: e.event, reason: "no payload defined in hook-bench.ts" });
        continue;
      }
      const key = `${e.event}:${e.id}`;
      if (tested.has(key)) continue;
      tested.add(key);
      for (const v of variants) {
        if (v.tool && !matchesTool(e.matcher, v.tool)) continue;
        const payload = { ...v.payload, cwd: repoRoot };
        const env = childEnv(sb, repoRoot, payload);
        const stdin = JSON.stringify(payload);
        const cwd = v.cwdWork ? sb.work : repoRoot;
        const samples: Sample[] = [];
        for (let i = 0; i < warmup + runs; i++) {
          const s = await runOnce(e.command, env, cwd, stdin);
          if (i >= warmup) samples.push(s);
        }
        const ms = samples.map((s) => s.ms);
        const exitCodes: Record<string, number> = {};
        for (const s of samples) exitCodes[s.exit] = (exitCodes[s.exit] ?? 0) + 1;
        rows.push({
          id: e.id,
          event: e.event,
          matcher: e.matcher,
          tool: v.tool,
          runs: ms.length,
          p50: median(ms),
          p95: percentile(ms, 95),
          min: Math.min(...ms),
          max: Math.max(...ms),
          mean: ms.reduce((a, b) => a + b, 0) / ms.length,
          exitCodes,
          withOutput: samples.filter((s) => s.stdoutBytes > 0).length,
        });
      }
    }
    // Everything the hooks wrote lives under the sandbox HOME.
    const ls = Bun.spawn(
      [
        "find",
        sb.home,
        "-type",
        "f",
        "-not",
        "-path",
        `${sb.home}/.claude/src/*`,
        "-not",
        "-path",
        `${sb.home}/Library/*`,
      ],
      {
        stdout: "pipe",
      },
    );
    sandboxFiles = (await new Response(ls.stdout).text())
      .trim()
      .split("\n")
      .map((p) => p.replace(sb.home, "$HOME"));
    await ls.exited;

    const after = await gitState(repoRoot);
    if (after !== before) {
      console.error(
        "ABORT: repo git status changed during the bench.\n--- before\n" +
          before +
          "--- after\n" +
          after,
      );
      process.exitCode = 1;
    }

    const scenarios = SCENARIOS.map((sc) => {
      const hooks = entries
        .filter(
          (e) =>
            !e.async &&
            !e.filter &&
            e.event === sc.event &&
            (sc.tool === null || matchesTool(e.matcher, sc.tool)),
        )
        .map((e) =>
          rows.find((r) => r.id === e.id && r.event === e.event && (!r.tool || r.tool === sc.tool)),
        )
        .filter((r): r is BenchRow => r !== undefined);
      const p50s = hooks.map((h) => h.p50);
      const p95s = hooks.map((h) => h.p95);
      return {
        label: sc.label,
        hooks: hooks.map((h) => h.id),
        sumP50: p50s.reduce((a, b) => a + b, 0),
        maxP50: Math.max(0, ...p50s),
        sumP95: p95s.reduce((a, b) => a + b, 0),
        maxP95: Math.max(0, ...p95s),
      };
    });

    const report = {
      machine: { arch: process.arch, platform: process.platform, bun: Bun.version },
      runs,
      warmup,
      floor: { p50: median(floorMs), p95: percentile(floorMs, 95), min: Math.min(...floorMs) },
      hooks: rows,
      scenarios,
      skipped,
      sandboxFilesWritten: sandboxFiles,
      repoGitStatusUnchanged: after === before,
    };
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const f = (n: number) => `${n.toFixed(1)}`.padStart(7);
      console.log(
        `Hook bench: ${runs} runs (+${warmup} warmup) per hook, ${process.arch}, bun ${Bun.version}\n`,
      );
      console.log(
        `Process-start floor (sh -c + empty bun script): p50 ${f(report.floor.p50)} ms, p95 ${f(report.floor.p95)} ms\n`,
      );
      console.log(
        "hook                        event               tool     p50 ms  p95 ms  min ms  max ms  exits / output",
      );
      for (const r of rows) {
        console.log(
          `${r.id.padEnd(27)} ${r.event.padEnd(19)} ${(r.tool ?? "-").padEnd(8)} ${f(r.p50)} ${f(r.p95)} ${f(r.min)} ${f(r.max)}  ${JSON.stringify(r.exitCodes)} ${r.withOutput}/${r.runs}`,
        );
      }
      console.log(
        "\nPer scenario (sum assumes hooks run one after another; max assumes fully parallel):",
      );
      for (const s of scenarios) {
        console.log(
          `  ${s.label.padEnd(18)} p50 sum ${f(s.sumP50)} max ${f(s.maxP50)} ms | p95 sum ${f(s.sumP95)} max ${f(s.maxP95)} ms  [${s.hooks.join(", ")}]`,
        );
      }
      console.log("\nSkipped:");
      for (const s of skipped)
        console.log(`  ${s.event.padEnd(18)} ${s.id.padEnd(28)} ${s.reason}`);
      console.log(`\nRepo git status unchanged: ${report.repoGitStatusUnchanged}`);
      console.log(
        `Files written under the sandbox HOME (excluding Bun's cache under Library/): ${sandboxFiles.length}`,
      );
    }
  } finally {
    await sb.cleanup();
  }
}

await main();
