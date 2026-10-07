#!/usr/bin/env bun
// Scores the eval cases with the full cc-settings standards loaded against
// vanilla Claude Code, so a skill or rule that no longer beats the bare model
// shows up as a candidate for deletion.
//
// `claude plugin eval` isolates both arms from ~/.claude and never loads a
// CLAUDE.md, so this builds a throwaway plugin whose SessionStart hooks inject
// AGENTS.md, CLAUDE-FULL.md and the output style as additionalContext. Hook
// context is capped near 10K characters, so the text goes in as several
// chunks. The `with` arm gets skills, agents and the standards; the `without`
// arm is vanilla. Not covered: settings.json hooks, permissions, and the
// output style's system-prompt placement.
//
// Usage: bun src/scripts/eval-ablate.ts [--tag <t>]... [--case <glob>]
//          [--runs <n>] [--max-cost-usd <n>] [--model <id>]
// Exit 0 when the run produced a report; 1 when it could not run.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const JUDGE_MODEL = "claude-haiku-4-5-20251001";
const CHUNK_CHARS = 9000;

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

function flags(name: string): string[] {
  return process.argv.flatMap((a, i) =>
    a === name && process.argv[i + 1] ? [name, process.argv[i + 1] as string] : [],
  );
}

function standardsChunks(): string[] {
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
  // additionalContext does not resolve @-imports; AGENTS.md is inlined instead.
  const full = read("CLAUDE-FULL.md").replace(/^@\S+\.md\s*$/gm, "");
  const text = [read("AGENTS.md"), full, read("output-styles/darkroom.md")].join("\n\n---\n\n");
  const chunks: string[] = [];
  let cur = "";
  for (const para of text.split("\n\n")) {
    if (cur && cur.length + para.length + 2 > CHUNK_CHARS) {
      chunks.push(cur);
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + para;
  }
  if (cur) chunks.push(cur);
  return chunks.map((c, i) => `[cc-settings standards, part ${i + 1} of ${chunks.length}]\n\n${c}`);
}

function buildPlugin(dir: string): void {
  mkdirSync(join(dir, ".claude-plugin"));
  mkdirSync(join(dir, "hooks"));
  writeFileSync(
    join(dir, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "darkroom-full",
      version: "0.0.0",
      description: "cc-settings ablation arm",
    }),
  );
  // src/ and zod back the ~/.claude/src copy below and fixtures that copy repo scripts.
  for (const sub of ["skills", "agents", "src"]) symlinkSync(join(ROOT, sub), join(dir, sub));
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(join(ROOT, "node_modules", "zod"), join(dir, "node_modules", "zod"));
  // The eval runner refuses to write results into a symlinked eval dir.
  cpSync(join(ROOT, "evals"), join(dir, "evals"), {
    recursive: true,
    filter: (src) => !src.startsWith(join(ROOT, "evals", "results")),
  });
  const hooks = standardsChunks().map((ctx, i) => {
    const file = `standards-${i}.json`;
    writeFileSync(
      join(dir, "hooks", file),
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx },
      }),
    );
    return { type: "command", command: `cat "\${CLAUDE_PLUGIN_ROOT}/hooks/${file}"`, timeout: 5 };
  });
  // Skills shell out to ~/.claude/src/scripts/*, which the eval's throwaway
  // HOME lacks; without them they fail and score as regressions. A copy, not
  // a symlink: the agent sandbox blocks reads that resolve into the temp dir.
  const root = "$" + "{CLAUDE_PLUGIN_ROOT}";
  const installScripts = {
    type: "command",
    command: `mkdir -p "$HOME/.claude/node_modules" && cp -RL "${root}/src" "$HOME/.claude/src" && cp -RL "${root}/node_modules/zod" "$HOME/.claude/node_modules/zod"`,
    timeout: 30,
  };
  writeFileSync(
    join(dir, "hooks", "hooks.json"),
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [installScripts, ...hooks] }] } }),
  );
}

if (!Bun.which("claude")) {
  console.error("[eval-ablate] claude CLI not found.");
  process.exit(1);
}

interface AblationReport {
  partial?: boolean;
  partialReason?: string;
  costUsd?: number;
  cases?: {
    name: string;
    aggregates?: { score?: number; scoreWithout?: number; delta?: number };
    arms?: Record<string, { error?: string | null }[]>;
  }[];
}

function positive(name: string, fallback: string): string {
  const v = flag(name, fallback);
  if (!(Number(v) > 0)) {
    console.error(`[eval-ablate] ${name} needs a positive number, got "${v}".`);
    process.exit(1);
  }
  return v;
}
// The CLI keeps only the last --case, so a second one would be silently dropped.
if (flags("--case").length > 2) {
  console.error("[eval-ablate] --case takes one name glob; run once per case or use --tag.");
  process.exit(1);
}
const runs = positive("--runs", "1");
// No default ceiling: on a subscription the reported cost is API-equivalent,
// not billed, and a manual run should finish. Pass the flag to bound one.
const maxCost = process.argv.includes("--max-cost-usd")
  ? ["--max-cost-usd", positive("--max-cost-usd", "")]
  : [];

const plugin = mkdtempSync(join(tmpdir(), "cc-settings-ablate-"));
const out = join(plugin, "report.json");
const kept = join(
  homedir(),
  ".claude",
  "tmp",
  // The mkdtemp suffix keeps parallel runs from sharing a directory.
  `eval-ablate-${new Date().toISOString().replace(/[:.]/g, "-")}-${basename(plugin).slice(-6)}`,
);
let proc: ReturnType<typeof Bun.spawnSync>;
let report: AblationReport = {};
try {
  buildPlugin(plugin);
  proc = Bun.spawnSync({
    cmd: [
      "claude",
      "plugin",
      "eval",
      plugin,
      ...flags("--tag"),
      ...flags("--case"),
      "--runs",
      runs,
      "-j",
      "1",
      "--ablation",
      "with-without",
      "--trust-plugin",
      "--scaffold",
      "--allow-tools",
      "Write",
      "Edit",
      "Bash",
      "--no-publish",
      "--model",
      flag("--model", "claude-sonnet-5-5"),
      "--judge-model",
      JUDGE_MODEL,
      "--threshold",
      "0",
      ...maxCost,
      "--json",
      out,
    ],
    cwd: plugin,
    stdout: "pipe",
    stderr: "inherit",
  });

  try {
    report = JSON.parse(readFileSync(out, "utf8")) as AblationReport;
  } catch {
    // No report: the CLI failed before writing one. Handled below.
  }
} finally {
  // Keep the HTML report and transcripts: the temp plugin dir is deleted.
  // A failed copy keeps that dir so the results are not lost.
  let archived = true;
  if (existsSync(join(plugin, "evals", "results"))) {
    try {
      cpSync(join(plugin, "evals", "results"), kept, { recursive: true });
      if (existsSync(out)) cpSync(out, join(kept, "report.json"));
    } catch (err) {
      archived = false;
      console.error(`[eval-ablate] could not keep results, left them in ${plugin}: ${err}`);
    }
  }
  if (archived) rmSync(plugin, { recursive: true, force: true });
}

if (!report.cases) {
  console.error(`[eval-ablate] eval did not produce a report (exit ${proc.exitCode}).`);
  process.exit(1);
}

if (report.partial) console.log(`partial run: ${report.partialReason ?? "unknown reason"}\n`);
const complete = report.cases.filter(
  (c) =>
    c.aggregates?.score !== undefined &&
    c.aggregates.scoreWithout !== undefined &&
    c.aggregates.delta !== undefined,
);
const notRun = report.cases.length - complete.length;
const rows = complete
  .map((c) => ({
    name: c.name,
    with: c.aggregates?.score ?? 0,
    without: c.aggregates?.scoreWithout ?? 0,
    delta: c.aggregates?.delta ?? 0,
    errors: Object.values(c.arms ?? {})
      .flat()
      .filter((run) => run.error).length,
  }))
  .sort((a, b) => a.delta - b.delta);
// The eval sandbox blocks writes to ~/.claude, so a skill that saves state
// through its scripts can fail there and still work on a real install.
function usesScripts(caseName: string): boolean {
  const skill = caseName.split("-").reduceRight<string | null>((found, _, i, parts) => {
    if (found) return found;
    const name = parts.slice(0, i + 1).join("-");
    return existsSync(join(ROOT, "skills", name, "SKILL.md")) ? name : null;
  }, null);
  if (!skill) return false;
  return /(\$HOME|~)\/\.claude\/src\//.test(
    readFileSync(join(ROOT, "skills", skill, "SKILL.md"), "utf8"),
  );
}
console.log("  with  vanilla  delta  case");
for (const r of rows) {
  const mark =
    (r.errors > 0
      ? `  <- ${r.errors} run(s) errored`
      : r.delta <= 0
        ? "  <- vanilla matches"
        : "") + (usesScripts(r.name) ? "  [uses ~/.claude scripts]" : "");
  console.log(
    `  ${r.with.toFixed(2)}  ${r.without.toFixed(2)}     ${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(2)}  ${r.name}${mark}`,
  );
}
const matched = rows.filter((r) => r.errors === 0 && r.delta <= 0).length;
console.log(`\n${matched} of ${rows.length} compared cases: vanilla scores at least as well.`);
if (notRun > 0) console.log(`${notRun} case(s) had no comparison (not run or not graded).`);
if (report.costUsd !== undefined) console.log(`cost $${report.costUsd.toFixed(2)}`);
if (rows.some((r) => usesScripts(r.name)))
  console.log("[uses ~/.claude scripts]: the eval sandbox blocks writes there; re-check by hand.");
if (existsSync(kept)) console.log(`results and transcripts: ${kept}`);
