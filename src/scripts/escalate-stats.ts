#!/usr/bin/env bun
// `bun run escalate:stats` — aggregate the fired-vs-acted telemetry for the
// model-escalation advisory (escalate-model.ts fires, escalate-acted.ts
// records acted). Read by humans and by /retro (skills/retro/SKILL.md) to
// decide whether the advisory's act-rate justifies a harder escalation.
//
// Correlation rule: computeStats (escalate-telemetry.ts) is the source of
// truth for pairing fired/acted lines and for the honesty guarantee that
// makes act-rate structurally <= 100% — see the comment there. This script
// only filters by --days and renders; it does not re-implement correlation.
//
// Malformed lines are skipped (parseTelemetryLine returns null for them),
// never fatal. A missing log prints "no telemetry yet" and exits 0. Any
// other read error (permissions, the log path being a directory, etc.) is
// a real failure, not "no telemetry yet" — see readTelemetryLog below.

import { readFile } from "node:fs/promises";
import {
  computeStats,
  parseTelemetryLine,
  TELEMETRY_LOG,
  type TelemetryEvent,
} from "../lib/escalate-telemetry.ts";

const USAGE = "Usage: escalate-stats [--days N]  (N must be a positive integer)";

/** Parse argv into a day-window filter. `null` days means lifetime (no flag
 *  given). Returns "invalid" for any malformed invocation so main() can print
 *  usage and exit 1 without guessing. */
function parseArgs(argv: string[]): { days: number | null } | "invalid" {
  if (argv.length === 0) return { days: null };
  if (argv.length === 2 && argv[0] === "--days") {
    const raw = argv[1];
    if (raw !== undefined && /^\d+$/.test(raw)) {
      const days = Number(raw);
      if (days > 0) return { days };
    }
  }
  return "invalid";
}

/** Read the telemetry log, distinguishing "never written yet" (ENOENT — the
 *  common, benign case) from a genuine read failure (EACCES, EISDIR, etc.,
 *  which must not be swallowed as "no telemetry"). */
async function readTelemetryLog(): Promise<{ kind: "ok"; text: string } | { kind: "missing" }> {
  try {
    return { kind: "ok", text: await readFile(TELEMETRY_LOG, "utf8") };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { kind: "missing" };
    console.error(`Failed to read telemetry log at ${TELEMETRY_LOG}: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args === "invalid") {
    console.error(USAGE);
    process.exit(1);
  }

  const read = await readTelemetryLog();
  if (read.kind === "missing") {
    console.log("No telemetry yet — the escalate advisory hasn't fired in this environment.");
    return;
  }

  let events: TelemetryEvent[] = read.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseTelemetryLine)
    .filter((e): e is TelemetryEvent => e !== null);

  const windowLabel = args.days === null ? "all time" : `last ${args.days} days`;
  if (args.days !== null) {
    const cutoff = Date.now() - args.days * 24 * 60 * 60_000;
    events = events.filter((e) => {
      const t = Date.parse(e.t);
      return Number.isNaN(t) ? false : t >= cutoff;
    });
  }

  if (events.length === 0) {
    console.log(
      `No telemetry yet — the escalate advisory hasn't fired in this environment (${windowLabel}).`,
    );
    return;
  }

  const stats = computeStats(events);
  const latency =
    stats.medianActedLatencyMs === null
      ? "n/a"
      : `${Math.round(stats.medianActedLatencyMs / 1000)}s`;

  const lines: string[] = [
    `=== Escalate advisory: fired vs acted (${windowLabel}) ===`,
    `Fired: ${stats.firedTotal}`,
    `Acted: ${stats.actedTotal}`,
    `Act rate: ${stats.actRate.toFixed(1)}%`,
    // "fire→completion": PostToolUse observes an Agent call on COMPLETION, not
    // spawn, so this includes the whole subagent runtime — see
    // ACTED_WINDOW_MS's comment in escalate-telemetry.ts and the recording
    // path in escalate-acted.ts. Never read this as time-to-decision.
    `Median acted latency (fire→completion): ${latency}`,
    "",
    "By variant (fired):",
    ...Object.entries(stats.byVariant).map(([variant, count]) => `  ${variant}: ${count}`),
    "",
    "By model (acted):",
    ...Object.entries(stats.byModel).map(([model, count]) => `  ${model}: ${count}`),
  ];
  console.log(lines.join("\n"));
}

await main();
