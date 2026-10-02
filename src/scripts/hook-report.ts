#!/usr/bin/env bun
// `bun run hooks:report` — how often each hook in config/40-hooks.json fires
// per session, derived from Claude Code's own transcripts, plus the Stop hook
// durations Claude Code records. With `--bench <file>` (the --json output of
// `bun run hooks:bench`) it multiplies firings by measured latency per
// hot-path event and for the three pilot hooks.
//
// Why not a `--hooks` flag on token-report: that script is organised around
// price-weighted request usage with its own session picker; hook counting
// needs different transcript fields and a different default scope (all
// projects, since hooks fire everywhere).

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  countTranscript,
  emptyCounts,
  firingsFor,
  type HookEntry,
  hooksConfigPath,
  loadHookEntries,
  matchesTool,
  median,
  percentile,
  type SessionCounts,
} from "../lib/hook-frequency.ts";
import { claudePath } from "../lib/platform.ts";
import { projectSlug } from "../lib/token-usage.ts";

const USAGE = `Usage: hook-report [--days N] [--project <path> | --all] [--bench <bench.json>] [--json]
  --days N          sessions modified in the last N days (default 14)
  --all             every project under ~/.claude/projects (default)
  --project <path>  only sessions for that working directory
  --bench <file>    combine with 'bun run hooks:bench --json' output
  --json            machine-readable report`;

interface Args {
  days: number;
  project: string | null;
  bench: string | null;
  json: boolean;
}

function parseArgs(argv: string[]): Args | "invalid" {
  const args: Args = { days: 14, project: null, bench: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--all") args.project = null;
    else if (flag === "--json") args.json = true;
    else if (flag === "--project" && value) {
      args.project = resolve(value);
      i++;
    } else if (flag === "--bench" && value) {
      args.bench = resolve(value);
      i++;
    } else if (flag === "--days" && value && /^\d+$/.test(value) && Number(value) > 0) {
      args.days = Number(value);
      i++;
    } else return "invalid";
  }
  return args;
}

async function loadSession(dir: string, id: string): Promise<SessionCounts> {
  const counts = emptyCounts(id);
  countTranscript(await readFile(join(dir, `${id}.jsonl`), "utf8"), counts, true);
  const subDir = join(dir, id, "subagents");
  const names = await readdir(subDir).catch(() => [] as string[]);
  for (const name of names.filter((n) => n.endsWith(".jsonl"))) {
    countTranscript(await readFile(join(subDir, name), "utf8"), counts, false);
  }
  return counts;
}

async function loadSessions(projectDirs: string[], days: number): Promise<SessionCounts[]> {
  const cutoff = Date.now() - days * 86_400_000;
  const picked: { dir: string; id: string }[] = [];
  for (const dir of projectDirs) {
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names.filter((n) => n.endsWith(".jsonl"))) {
      const s = await stat(join(dir, name)).catch(() => null);
      if (s && s.mtimeMs >= cutoff) picked.push({ dir, id: name.replace(/\.jsonl$/, "") });
    }
  }
  const sessions = await Promise.all(picked.map((p) => loadSession(p.dir, p.id)));
  return sessions.filter((s) => s.calls.length > 0 || s.prompts > 0);
}

// ── Report ───────────────────────────────────────────────────────────────────

interface FiringRow {
  id: string;
  event: string;
  matcher: string | null;
  filter: string | null;
  async: boolean;
  /** null: the transcript has no record of this event. */
  median: number | null;
  mean: number | null;
  p90: number | null;
  total: number | null;
}

function firingRows(entries: HookEntry[], sessions: SessionCounts[]): FiringRow[] {
  return entries.map((e) => {
    const per = sessions.map((s) => firingsFor(e, s));
    const counted = per.filter((n): n is number => n !== null);
    const countable = counted.length === per.length && per.length > 0;
    return {
      id: e.id,
      event: e.event,
      matcher: e.matcher,
      filter: e.filter,
      async: e.async,
      median: countable ? median(counted) : null,
      mean: countable ? counted.reduce((a, b) => a + b, 0) / counted.length : null,
      p90: countable ? percentile(counted, 90) : null,
      total: countable ? counted.reduce((a, b) => a + b, 0) : null,
    };
  });
}

interface StopRow {
  command: string;
  n: number;
  p50: number;
  p95: number;
}

function stopRows(sessions: SessionCounts[]): StopRow[] {
  const by = new Map<string, number[]>();
  for (const s of sessions) {
    for (const h of s.stopHooks) by.set(h.command, [...(by.get(h.command) ?? []), h.durationMs]);
  }
  return [...by]
    .map(([command, v]) => ({
      command,
      n: v.length,
      p50: median(v),
      p95: percentile(v, 95),
    }))
    .sort((a, b) => b.n - a.n);
}

// ── Combine with bench ───────────────────────────────────────────────────────

interface BenchRow {
  id: string;
  tool?: string;
  p50: number;
  p95: number;
}

interface Bench {
  hooks: BenchRow[];
  runs: number;
}

function latency(bench: Bench, id: string, tool: string | null): BenchRow | undefined {
  const rows = bench.hooks.filter((r) => r.id === id);
  return rows.find((r) => tool !== null && r.tool === tool) ?? rows.find((r) => !r.tool);
}

const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure"]);

interface EntryCost {
  /** Per session: firings on benched tools, and their summed latency in ms. */
  firings: number[];
  ms: number[];
  rows: BenchRow[];
  /** Tools the entry fired on that have no bench row of their own. */
  missing: string[];
}

/** Prices each tool's calls with that tool's own bench row, so a group
 *  spanning Edit and Write never bills Write calls at Edit's latency. */
function entryCost(
  e: HookEntry,
  sessions: SessionCounts[],
  bench: Bench,
  tools: string[] | null,
): EntryCost {
  const seen = TOOL_EVENTS.has(e.event)
    ? [...new Set(sessions.flatMap((s) => s.calls.map((c) => c.tool)))].filter(
        (t) => matchesTool(e.matcher, t) && (!tools || tools.includes(t)),
      )
    : [null];
  const priced: { tool: string | null; row: BenchRow }[] = [];
  const missing: string[] = [];
  for (const tool of seen) {
    const row = latency(bench, e.id, tool);
    if (row) priced.push({ tool, row });
    else if (tool) missing.push(tool);
  }
  const firings: number[] = [];
  const ms: number[] = [];
  for (const s of sessions) {
    let f = 0;
    let t = 0;
    for (const { tool, row } of priced) {
      const scoped = tool === null ? s : { ...s, calls: s.calls.filter((c) => c.tool === tool) };
      const n = firingsFor(e, scoped) ?? 0;
      f += n;
      t += n * row.p50;
    }
    firings.push(f);
    ms.push(t);
  }
  return { firings, ms, rows: priced.map((p) => p.row), missing };
}

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

interface Group {
  label: string;
  event: string;
  tools: string[] | null;
}

const GROUPS: Group[] = [
  {
    label: "PreToolUse Edit/Write/MultiEdit",
    event: "PreToolUse",
    tools: ["Edit", "Write", "MultiEdit"],
  },
  { label: "PreToolUse Bash", event: "PreToolUse", tools: ["Bash"] },
  { label: "PostToolUse (all tools)", event: "PostToolUse", tools: null },
  { label: "UserPromptSubmit", event: "UserPromptSubmit", tools: null },
];

const PILOT = ["pre-edit-validate", "freeze-guard", "knowledge-hint"];

interface GroupLine {
  label: string;
  hooks: {
    id: string;
    medianFirings: number;
    meanFirings: number;
    p50: number;
    ms: number;
    msMean: number;
    benchedAs: string;
  }[];
  /** Sum over hooks of median firings per session x p50 latency, ms. */
  msPerSession: number;
  /** Same sum using mean firings (sessions with no such calls count as zero). */
  msPerSessionMean: number;
  pctOfActive: number | null;
  /** msPerSessionMean over mean active time: total hook time / total active time. */
  pctOfActiveMean: number | null;
  /** Entries in the group with no bench row (async excluded, skipped, or filtered). */
  unbenched: string[];
}

function combineGroup(
  g: Group,
  entries: HookEntry[],
  sessions: SessionCounts[],
  bench: Bench,
  activeMs: number,
  meanActiveMs: number,
): GroupLine {
  const hooks: GroupLine["hooks"] = [];
  const unbenched: string[] = [];
  for (const e of entries) {
    if (e.event !== g.event || e.async) continue;
    if (g.tools && !g.tools.some((t) => matchesTool(e.matcher, t))) continue;
    if (e.filter) {
      unbenched.push(`${e.id} (if ${e.filter})`);
      continue;
    }
    const cost = entryCost(e, sessions, bench, g.tools);
    for (const t of cost.missing) unbenched.push(`${e.id}@${t}`);
    const first = cost.rows[0];
    if (!first) {
      if (cost.missing.length === 0) unbenched.push(e.id);
      continue;
    }
    const meanFirings = mean(cost.firings);
    const msMean = mean(cost.ms);
    hooks.push({
      id: e.id,
      medianFirings: median(cost.firings),
      meanFirings,
      // Firing-weighted across tools; the single row's p50 when nothing fired.
      p50: meanFirings > 0 ? msMean / meanFirings : first.p50,
      ms: median(cost.ms),
      msMean,
      benchedAs: cost.rows.map((r) => (r.tool ? `${r.id}@${r.tool}` : r.id)).join(", "),
    });
  }
  const msPerSession = hooks.reduce((a, h) => a + h.ms, 0);
  return {
    label: g.label,
    hooks,
    msPerSession,
    msPerSessionMean: hooks.reduce((a, h) => a + h.msMean, 0),
    pctOfActive: activeMs > 0 ? (msPerSession / activeMs) * 100 : null,
    pctOfActiveMean:
      meanActiveMs > 0 ? (hooks.reduce((a, h) => a + h.msMean, 0) / meanActiveMs) * 100 : null,
    unbenched,
  };
}

interface PilotCall {
  tool: string;
  hooks: { id: string; p50: number; p95: number }[];
  sumP50: number;
  maxP50: number;
  sumP95: number;
  maxP95: number;
}

function pilotPerCall(entries: HookEntry[], bench: Bench, tool: string): PilotCall {
  const hooks: PilotCall["hooks"] = [];
  for (const e of entries) {
    if (e.event !== "PreToolUse" || !PILOT.includes(e.id) || !matchesTool(e.matcher, tool))
      continue;
    const row = latency(bench, e.id, tool);
    if (row) hooks.push({ id: e.id, p50: row.p50, p95: row.p95 });
  }
  const p50s = hooks.map((h) => h.p50);
  const p95s = hooks.map((h) => h.p95);
  return {
    tool,
    hooks,
    sumP50: p50s.reduce((a, b) => a + b, 0),
    maxP50: Math.max(0, ...p50s),
    sumP95: p95s.reduce((a, b) => a + b, 0),
    maxP95: Math.max(0, ...p95s),
  };
}

// ── Output ───────────────────────────────────────────────────────────────────

const ms1 = (n: number) => `${n.toFixed(1)} ms`;
const fmt = (n: number | null) => (n === null ? "n/a" : String(n));
const s1 = (n: number) => `${(n / 1000).toFixed(0)} s`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args === "invalid") {
    console.error(USAGE);
    process.exit(1);
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const entries = await loadHookEntries(hooksConfigPath(repoRoot));
  const root = claudePath("projects");
  const projectDirs = args.project
    ? [join(root, projectSlug(args.project))]
    : (await readdir(root).catch(() => [] as string[])).map((d) => join(root, d));
  const sessions = await loadSessions(projectDirs, args.days);
  if (sessions.length === 0) {
    console.log("No transcripts found.");
    return;
  }

  const toolTotals = new Map<string, number[]>();
  for (const s of sessions) {
    const per = new Map<string, number>();
    for (const c of s.calls) per.set(c.tool, (per.get(c.tool) ?? 0) + 1);
    for (const [tool, n] of per) toolTotals.set(tool, [...(toolTotals.get(tool) ?? []), n]);
  }
  const perSession = {
    toolCalls: median(sessions.map((s) => s.calls.length)),
    prompts: median(sessions.map((s) => s.prompts)),
    turns: median(sessions.map((s) => s.turns)),
    compactions: median(sessions.map((s) => s.compactions)),
    subagentSpawns: median(sessions.map((s) => s.subagentSpawns)),
    activeMs: median(sessions.map((s) => s.activeMs)),
    spanMs: median(sessions.map((s) => s.spanMs)),
    meanActiveMs: sessions.reduce((a, s) => a + s.activeMs, 0) / sessions.length,
  };
  const byTool = [...toolTotals]
    .map(([tool, v]) => ({
      tool,
      sessionsUsing: v.length,
      total: v.reduce((a, b) => a + b, 0),
      // Median over sessions that used the tool at all.
      medianWhenUsed: median(v),
    }))
    .sort((a, b) => b.total - a.total);
  const rows = firingRows(entries, sessions);
  const stops = stopRows(sessions);
  const stopWall = sessions.flatMap((s) => s.stopWallMs);

  const meanActiveMs = perSession.meanActiveMs;
  let combined: {
    benchRuns: number;
    groups: GroupLine[];
    pilot: {
      perCall: PilotCall[];
      msPerSession: number;
      pctOfActive: number | null;
      msPerSessionMean: number;
      pctOfActiveMean: number | null;
    };
  } | null = null;
  if (args.bench) {
    const bench = JSON.parse(await readFile(args.bench, "utf8")) as Bench;
    const groups = GROUPS.map((g) =>
      combineGroup(g, entries, sessions, bench, perSession.activeMs, meanActiveMs),
    );
    let pilotMs = 0;
    let pilotMsMean = 0;
    for (const e of entries) {
      if (e.event !== "PreToolUse" || !PILOT.includes(e.id)) continue;
      const cost = entryCost(e, sessions, bench, null);
      pilotMs += median(cost.ms);
      pilotMsMean += mean(cost.ms);
    }
    combined = {
      benchRuns: bench.runs,
      groups,
      pilot: {
        perCall: ["Edit", "Write"].map((t) => pilotPerCall(entries, bench, t)),
        msPerSession: pilotMs,
        pctOfActive: perSession.activeMs > 0 ? (pilotMs / perSession.activeMs) * 100 : null,
        msPerSessionMean: pilotMsMean,
        pctOfActiveMean: meanActiveMs > 0 ? (pilotMsMean / meanActiveMs) * 100 : null,
      },
    };
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          days: args.days,
          sessions: sessions.length,
          perSession,
          byTool,
          firings: rows,
          stopHookDurations: stops,
          stopWallMs: { n: stopWall.length, p50: median(stopWall), p95: percentile(stopWall, 95) },
          combined,
        },
        null,
        2,
      ),
    );
    return;
  }

  const scope = args.project ? projectSlug(args.project) : "all projects";
  console.log(`Hook firings: ${sessions.length} sessions, last ${args.days} days, ${scope}\n`);
  console.log(
    `Median per session: ${perSession.toolCalls} tool calls, ${perSession.prompts} prompts, ${perSession.turns} turns, ` +
      `${perSession.compactions} compactions, ${perSession.subagentSpawns} subagent spawns; ` +
      `active ${s1(perSession.activeMs)}, span ${s1(perSession.spanMs)}\n`,
  );
  console.log("Tool calls by tool (sessions using it, total, median when used):");
  for (const t of byTool.slice(0, 12)) {
    console.log(
      `  ${t.tool.padEnd(24)} ${String(t.sessionsUsing).padStart(4)} sessions ${String(t.total).padStart(6)} calls  median ${t.medianWhenUsed}`,
    );
  }
  console.log(
    "\nFirings per session by hook entry (derived from matchers; median / mean / p90 / total; all sessions in the window, zeros included):",
  );
  for (const r of rows) {
    const where = [r.matcher, r.filter ? `if ${r.filter}` : null].filter(Boolean).join(" ");
    console.log(
      `  ${r.event.padEnd(18)} ${r.id.padEnd(26)} ${(r.async ? "async" : "sync").padEnd(5)} ${fmt(r.median).padStart(5)} ${(r.mean === null ? "n/a" : r.mean.toFixed(1)).padStart(7)} ${fmt(r.p90).padStart(5)} ${fmt(r.total).padStart(7)}  ${where}`,
    );
  }
  console.log(
    `\nStop hook durationMs as recorded by Claude Code (${stopWall.length} Stop firings; slowest hook per firing: p50 ${stopWall.length ? median(stopWall) : "n/a"} ms, p95 ${stopWall.length ? percentile(stopWall, 95) : "n/a"} ms):`,
  );
  for (const s of stops) {
    console.log(
      `  n=${String(s.n).padStart(4)}  p50 ${String(s.p50).padStart(4)} ms  p95 ${String(s.p95).padStart(4)} ms  ${s.command}`,
    );
  }
  if (combined) {
    console.log(
      `\nCombined with bench (${combined.benchRuns} runs per hook; median firings per session x bench p50):`,
    );
    for (const g of combined.groups) {
      const pct = g.pctOfActive === null ? "n/a" : `${g.pctOfActive.toFixed(2)}%`;
      console.log(
        `  ${g.label}: ${ms1(g.msPerSession)} per session at median firings (${pct} of median active time); ${ms1(g.msPerSessionMean)} at mean firings (${g.pctOfActiveMean === null ? "n/a" : `${g.pctOfActiveMean.toFixed(2)}%`} of mean active time)`,
      );
      for (const h of g.hooks) {
        console.log(
          `      ${h.id.padEnd(26)} ${String(h.medianFirings).padStart(5)} x ${ms1(h.p50)} = ${ms1(h.ms)}  (mean ${h.meanFirings.toFixed(1)} firings)`,
        );
      }
      if (g.unbenched.length > 0) console.log(`      not benched: ${g.unbenched.join(", ")}`);
    }
    console.log(
      "\nPilot hooks (pre-edit-validate, freeze-guard, knowledge-hint), blocking per call:",
    );
    for (const c of combined.pilot.perCall) {
      console.log(
        `  ${c.tool}: ${c.hooks.map((h) => h.id).join(" + ")}  p50 sum ${ms1(c.sumP50)} (parallel: ${ms1(c.maxP50)}), p95 sum ${ms1(c.sumP95)} (parallel: ${ms1(c.maxP95)})`,
      );
    }
    const pct =
      combined.pilot.pctOfActive === null ? "n/a" : `${combined.pilot.pctOfActive.toFixed(2)}%`;
    console.log(
      `  per session (each hook's own matcher): ${ms1(combined.pilot.msPerSession)}, ${pct} of median active time; ${ms1(combined.pilot.msPerSessionMean)} at mean firings, ${combined.pilot.pctOfActiveMean === null ? "n/a" : `${combined.pilot.pctOfActiveMean.toFixed(2)}%`} of mean active time (mean active ${s1(meanActiveMs)})`,
    );
  }
}

await main();
