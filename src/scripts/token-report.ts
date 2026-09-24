#!/usr/bin/env bun
// `bun run tokens` — price-weighted token spend per session, read from Claude
// Code's own transcripts. Splits cost by billing type (uncached input, cache
// writes by TTL, cache reads, output), main session vs subagents, and
// subagent type, and reports the cold prefix each thread pays before any
// work. Use it to measure a harness change before and after: run the same
// window, compare cost per session and the shares, not raw token counts.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { claudePath } from "../lib/platform.ts";
import {
  BILLING_TYPES,
  type Breakdown,
  buildReport,
  cacheHitRate,
  parseTranscript,
  projectSlug,
  type SessionUsage,
  type Thread,
  total,
} from "../lib/token-usage.ts";

const USAGE = `Usage: token-report [--project <path> | --all] [--sessions N] [--days N] [--json]
  --project <path>  sessions for that working directory (default: cwd)
  --all             every project under ~/.claude/projects
  --sessions N      newest N sessions (default 30)
  --days N          only sessions modified in the last N days
  --json            machine-readable report`;

interface Args {
  project: string | null;
  sessions: number;
  days: number | null;
  json: boolean;
}

function parseArgs(argv: string[]): Args | "invalid" {
  const args: Args = { project: process.cwd(), sessions: 30, days: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--all") args.project = null;
    else if (flag === "--json") args.json = true;
    else if (flag === "--project" && value) {
      args.project = resolve(value);
      i++;
    } else if (
      (flag === "--sessions" || flag === "--days") &&
      value &&
      /^\d+$/.test(value) &&
      Number(value) > 0
    ) {
      if (flag === "--sessions") args.sessions = Number(value);
      else args.days = Number(value);
      i++;
    } else return "invalid";
  }
  return args;
}

async function readThread(path: string, kind: string): Promise<Thread> {
  return { kind, requests: parseTranscript(await readFile(path, "utf8")) };
}

async function readSubagents(dir: string): Promise<Thread[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const threads: Thread[] = [];
  for (const name of names.filter((n) => n.endsWith(".jsonl"))) {
    let kind = "unknown";
    try {
      const meta = JSON.parse(
        await readFile(join(dir, name.replace(/\.jsonl$/, ".meta.json")), "utf8"),
      );
      if (typeof meta?.agentType === "string") kind = meta.agentType;
    } catch {
      // No meta file: older transcript, keep "unknown".
    }
    threads.push(await readThread(join(dir, name), kind));
  }
  return threads;
}

async function listSessions(projectDirs: string[], args: Args): Promise<SessionUsage[]> {
  const candidates: { dir: string; id: string; mtimeMs: number }[] = [];
  for (const dir of projectDirs) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names.filter((n) => n.endsWith(".jsonl"))) {
      const s = await stat(join(dir, name));
      candidates.push({ dir, id: name.replace(/\.jsonl$/, ""), mtimeMs: s.mtimeMs });
    }
  }
  const cutoff = args.days ? Date.now() - args.days * 86_400_000 : 0;
  const picked = candidates
    .filter((c) => c.mtimeMs >= cutoff)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, args.sessions);
  return Promise.all(
    picked.map(async (c) => ({
      id: c.id,
      mtimeMs: c.mtimeMs,
      main: await readThread(join(c.dir, `${c.id}.jsonl`), "main"),
      subagents: await readSubagents(join(c.dir, c.id, "subagents")),
    })),
  );
}

const AGENT_ROWS = 15;

const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number, d: number) => (d === 0 ? "0%" : `${Math.round((n / d) * 100)}%`);
const kTok = (n: number) => `${(n / 1000).toFixed(1)}K`;

function shareLine(label: string, b: Breakdown, whole: number): string {
  const cells = BILLING_TYPES.map((k) => `${k} ${pct(b[k], whole)}`).join(" · ");
  return `  ${label.padEnd(9)} ${usd(total(b)).padStart(9)}  ${cells}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args === "invalid") {
    console.error(USAGE);
    process.exit(1);
  }
  const root = claudePath("projects");
  const projectDirs = args.project
    ? [join(root, projectSlug(args.project))]
    : (await readdir(root).catch(() => [])).map((d) => join(root, d));
  const sessions = await listSessions(projectDirs, args);
  const r = buildReport(sessions);
  if (args.json) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  if (sessions.length === 0) {
    console.log("No transcripts found.");
    return;
  }
  const all = total(r.cost.main) + total(r.cost.subagent);
  const scope = args.project ? projectSlug(args.project) : "all projects";
  console.log(`Token spend: ${r.sessions} sessions, ${scope} (API-equivalent USD)\n`);
  console.log(
    `Total ${usd(all)} · ${usd(all / r.sessions)} per session · median ${r.requestsPerSession} requests per session\n`,
  );
  console.log("Cost by billing type:");
  console.log(shareLine("main", r.cost.main, all));
  console.log(shareLine("subagent", r.cost.subagent, all));
  console.log(
    `\nMain: ${r.requests.main} requests, cache hit ${pct(cacheHitRate(r.tokens.main), 1)}, cold prefix ${kTok(r.coldPrefix.main)}`,
  );
  console.log(
    `Subagents: ${r.requests.subagent} requests, cache hit ${pct(cacheHitRate(r.tokens.subagent), 1)}, cold prefix ${kTok(r.coldPrefix.subagent)}`,
  );
  const agents = Object.entries(r.byAgent).sort((a, b) => b[1].cost - a[1].cost);
  if (agents.length > 0) {
    console.log("\nBy subagent type:");
    const shown = agents.slice(0, AGENT_ROWS);
    for (const [kind, a] of shown) {
      console.log(
        `  ${kind.padEnd(20)} ${String(a.spawns).padStart(3)} spawns  ${String(a.requests).padStart(5)} req  ${usd(a.cost).padStart(9)}  ${usd(a.cost / a.spawns)}/spawn  cold ${kTok(a.coldPrefix)}`,
      );
    }
    const rest = agents.slice(AGENT_ROWS);
    if (rest.length > 0) {
      const cost = rest.reduce((s, [, a]) => s + a.cost, 0);
      console.log(`  ${rest.length} more types, ${usd(cost)} combined (--json lists all)`);
    }
  }
  console.log("\nBy model:");
  for (const [model, cost] of Object.entries(r.byModel).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${model.padEnd(20)} ${usd(cost).padStart(9)}  ${pct(cost, all)}`);
  }
  if (r.unpricedModels.length > 0)
    console.log(`\nUnpriced (excluded from cost): ${r.unpricedModels.join(", ")}`);
}

await main();
