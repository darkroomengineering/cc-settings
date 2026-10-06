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
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  for (const sub of ["skills", "agents"]) symlinkSync(join(ROOT, sub), join(dir, sub));
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
  writeFileSync(
    join(dir, "hooks", "hooks.json"),
    JSON.stringify({ hooks: { SessionStart: [{ hooks }] } }),
  );
}

if (!Bun.which("claude")) {
  console.error("[eval-ablate] claude CLI not found.");
  process.exit(1);
}

const plugin = mkdtempSync(join(tmpdir(), "cc-settings-ablate-"));
const out = join(plugin, "report.json");
buildPlugin(plugin);

const proc = Bun.spawnSync({
  cmd: [
    "claude",
    "plugin",
    "eval",
    plugin,
    ...flags("--tag"),
    ...flags("--case"),
    "--runs",
    flag("--runs", "1"),
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
    "--max-cost-usd",
    flag("--max-cost-usd", "10"),
    "--json",
    out,
  ],
  cwd: plugin,
  stdout: "pipe",
  stderr: "inherit",
});

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
let report: AblationReport = {};
try {
  report = JSON.parse(readFileSync(out, "utf8")) as AblationReport;
} catch {
  // No report: the CLI failed before writing one. Handled below.
}
rmSync(plugin, { recursive: true, force: true });

if (!report.cases) {
  console.error(`[eval-ablate] eval did not produce a report (exit ${proc.exitCode}).`);
  process.exit(1);
}

const rows = report.cases
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
console.log("  with  vanilla  delta  case");
for (const r of rows) {
  const mark =
    r.errors > 0 ? `  <- ${r.errors} run(s) errored` : r.delta <= 0 ? "  <- vanilla matches" : "";
  console.log(
    `  ${r.with.toFixed(2)}  ${r.without.toFixed(2)}     ${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(2)}  ${r.name}${mark}`,
  );
}
const matched = rows.filter((r) => r.errors === 0 && r.delta <= 0).length;
console.log(`\n${matched} of ${rows.length} cases: vanilla scores at least as well.`);
if (report.costUsd !== undefined) console.log(`cost $${report.costUsd.toFixed(2)}`);
if (report.partial) console.log(`partial run: ${report.partialReason ?? "unknown reason"}`);
