#!/usr/bin/env bun
// Claude bash command audit — categorized command analysis.
// Port of scripts/claude-audit.sh. Reads logs at
// ~/.claude/logs/bash-YYYY-MM-DD.log (format: `[HH:MM:SS] [project] command`).
//
// Invoked as a one-shot CLI via `bun run claude-audit`; no hook-protocol concerns.

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { claudePath, ymd } from "../lib/platform.ts";

const LOG_DIR = claudePath("logs");

// --- Helpers --------------------------------------------------------------

function padBar(val: number, max: number, width = 12): string {
  const filled = max > 0 ? Math.floor((val * width) / max) : 0;
  return "█".repeat(filled).padEnd(width, " ");
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

function classifyBashCommand(cmd: string): string {
  const c = cmd.trim();
  if (/^git\b/.test(c)) {
    const sub = c.match(/^git\s+([a-z-]+)/)?.[1] ?? "";
    return `git:${sub}`;
  }
  if (/^python3?\s+-c\b/.test(c)) return "python:inline script";
  if (/^python3?\s+[^-]/.test(c)) {
    const script = c.match(/^python3?\s+(\S+)/)?.[1] ?? "";
    return `python:${basename(script)}`;
  }
  if (/^bun\s+run\b/.test(c)) {
    const task = c.match(/^bun run\s+(\S+)/)?.[1] ?? "";
    return `bun:run ${task}`;
  }
  if (/^(bunx|npx)\b/.test(c)) {
    const parts = c.split(/\s+/);
    return `node:${parts[0] ?? ""} ${parts[1] ?? ""}`;
  }
  if (/^(bun|node|npm)\b/.test(c)) {
    const parts = c.split(/\s+/);
    return `node:${parts[0] ?? ""} ${parts[1] ?? ""}`;
  }
  if (/^bash\s+-c\b/.test(c)) return "bash:inline script";
  if (/^bash\s+[^-]/.test(c)) {
    const script = c.match(/^bash\s+(\S+)/)?.[1] ?? "";
    return `bash:${basename(script)}`;
  }
  if (/^(cat|head|tail|less|more|wc)\b/.test(c)) return `file:${c.split(/\s+/)[0]}`;
  if (/^(ls|tree)\b/.test(c)) return `file:${c.split(/\s+/)[0]}`;
  if (/^(cp|mv|mkdir|touch|chmod|chown)\b/.test(c)) return `file:${c.split(/\s+/)[0]}`;
  if (/^rm\b/.test(c)) return "file:rm";
  if (/^(find|grep|rg|ag|fd)\b/.test(c)) return `search:${c.split(/\s+/)[0]}`;
  if (/^(curl|wget|ssh|scp|rsync)\b/.test(c)) {
    const t = c.split(/\s+/)[0] ?? "";
    return `net:${basename(t)}`;
  }
  if (/^(echo|printf|date|whoami|hostname|uname|env|defaults|pmset|sw_vers|ioreg)\b/.test(c)) {
    return `system:${c.split(/\s+/)[0]}`;
  }
  if (/^(docker|podman|docker-compose)\b/.test(c)) {
    const parts = c.split(/\s+/);
    return `docker:${parts[0] ?? ""} ${parts[1] ?? ""}`;
  }
  const first = c.split(/\s+/)[0] ?? "";
  return `other:${basename(first)}`;
}

// --- Log parsing ----------------------------------------------------------

type LogLine = { time: string; project: string; cmd: string };

const LINE_RE = /^\[([^\]]*)\]\s+\[([^\]]*)\]\s+(.*)$/;

function parseLines(files: string[]): LogLine[] {
  const out: LogLine[] = [];
  for (const f of files) {
    if (!existsSync(f)) continue;
    for (const raw of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = raw.match(LINE_RE);
      if (!m) continue;
      out.push({ time: m[1] ?? "", project: m[2] ?? "", cmd: m[3] ?? "" });
    }
  }
  return out;
}

function countBy<T>(items: T[], key: (v: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function sortDesc(m: Map<string, number>): Array<[string, number]> {
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// --- AuditModel -----------------------------------------------------------

/** A classified command line. */
type ClassifiedLine = LogLine & { klass: string };

/** Per-group aggregation for command categories. */
interface CommandGroup {
  name: string;
  count: number;
  /** Top details within this group (up to 6). */
  details: Array<{ name: string; count: number }>;
  detailMax: number;
}

/** A security flag. */
interface SecurityFlag {
  time: string;
  desc: string;
  cmd: string;
}

/** A session (15-min idle threshold). */
interface AuditSession {
  start: string;
  end: string;
  count: number;
  domProject: string;
  durationMs: number;
}

/** A context-heavy operation hit. */
interface CtxHit {
  time: string;
  cmd: string;
  reason: string;
}

/**
 * Fully structured audit data — no formatting, no I/O.
 * Produced by `analyzeCommands`, consumed by `renderAudit`.
 */
export interface AuditModel {
  label: string;
  totalCommands: number;
  /** null when there are no commands (empty data case). */
  data: {
    /** Command groups sorted descending by count. */
    groups: CommandGroup[];
    globalMax: number;
    /** Project distribution sorted descending by count. */
    projects: Array<{ name: string; count: number }>;
    projectMax: number;
    securityFlags: SecurityFlag[];
    /** Exact commands repeated 3+ times, sorted descending, top 5. */
    repeated: Array<{ cmd: string; count: number }>;
    /** Top 3 sessions by command count. */
    topSessions: AuditSession[];
    totalSessions: number;
    ctxHits: CtxHit[];
  } | null;
}

// --- analyzeCommands (pure data stage) ------------------------------------

function timeToMs(t: string): number {
  const parts = t.split(":").map(Number);
  return ((parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)) * 1000;
}

/**
 * Parse and classify log lines, aggregate all sections into an `AuditModel`.
 * Pure function — no console output, no side effects.
 */
export function analyzeCommands(label: string, files: string[]): AuditModel {
  const lines = parseLines(files);
  if (lines.length === 0) {
    return { label, totalCommands: 0, data: null };
  }

  const classified: ClassifiedLine[] = lines.map((l) => ({
    ...l,
    klass: classifyBashCommand(l.cmd),
  }));

  // --- Command groups ---
  const groupCounts = countBy(classified, (v) => v.klass.split(":")[0] ?? "other");
  const sortedGroups = sortDesc(groupCounts);
  const globalMax = sortedGroups[0]?.[1] ?? 0;

  const groups: CommandGroup[] = sortedGroups.map(([gname, gcount]) => {
    const detailMap = countBy(
      classified.filter((v) => v.klass.startsWith(`${gname}:`)),
      (v) => v.klass.slice(gname.length + 1),
    );
    const sortedDetails = sortDesc(detailMap);
    const dmax = sortedDetails[0]?.[1] ?? 0;
    const details = sortedDetails.slice(0, 6).map(([dname, dcount]) => ({
      name: dname,
      count: dcount,
    }));
    return { name: gname, count: gcount, details, detailMax: dmax };
  });

  // --- Project distribution ---
  const projectMap = countBy(lines, (v) => v.project);
  const sortedProjects = sortDesc(projectMap);
  const projectMax = sortedProjects[0]?.[1] ?? 0;
  const projects = sortedProjects.map(([name, count]) => ({ name, count }));

  // --- Security scan ---
  const securityFlags: SecurityFlag[] = [];
  for (const l of lines) {
    const c = l.cmd;
    let desc = "";
    if (/curl.*\|\s*(ba)?sh/i.test(c)) desc = "piping curl to shell";
    else if (/\bsudo\b/i.test(c)) desc = "sudo usage";
    else if (/\brm\s+-rf\b/i.test(c)) desc = "recursive force delete";
    else if (/~\/\.ssh|~\/\.aws|~\/\.gnupg|~\/\.env/i.test(c)) desc = "touching sensitive paths";
    else if (/\bchmod\s+777\b/i.test(c)) desc = "world-writable permissions";
    else if (/password=|secret=|token=|api.key=/i.test(c)) desc = "possible credential in command";
    else if (/\bscp\b|rsync.*@/i.test(c)) desc = "remote file transfer";
    else if (/git\s+push\s+--force|git\s+push\s+-f/i.test(c)) desc = "force push";
    else if (/git\s+reset\s+--hard/i.test(c)) desc = "hard reset";
    if (desc) securityFlags.push({ time: l.time, desc, cmd: c });
  }

  // --- Repeated commands ---
  const repeatMap = countBy(lines, (v) => v.cmd);
  const repeated = sortDesc(repeatMap)
    .filter(([, count]) => count >= 3)
    .slice(0, 5)
    .map(([cmd, count]) => ({ cmd, count }));

  // --- Sessions ---
  const SESSION_GAP_MS = 15 * 60 * 1000;

  type RawSession = {
    start: string;
    end: string;
    count: number;
    projects: Map<string, number>;
  };

  const rawSessions: RawSession[] = [];
  let cur: RawSession | null = null;
  let prevMs = -1;

  for (const l of lines) {
    const ms = timeToMs(l.time);
    if (cur === null || ms - prevMs > SESSION_GAP_MS) {
      cur = { start: l.time, end: l.time, count: 0, projects: new Map() };
      rawSessions.push(cur);
    }
    cur.end = l.time;
    cur.count++;
    cur.projects.set(l.project, (cur.projects.get(l.project) ?? 0) + 1);
    prevMs = ms;
  }

  const totalSessions = rawSessions.length;
  const topSessions: AuditSession[] = [...rawSessions]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((s) => ({
      start: s.start,
      end: s.end,
      count: s.count,
      domProject: [...s.projects.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—",
      durationMs: timeToMs(s.end) - timeToMs(s.start),
    }));

  // --- Context-heavy ops ---
  const ctxHits: CtxHit[] = [];
  for (const l of lines) {
    const c = l.cmd.trim();
    let reason = "";
    if (/^(cat|head|tail|less)\b/.test(c)) reason = "file reader (prefer Read tool)";
    else if (/^find\s+[./~]/.test(c)) reason = "broad find scan";
    else if (/^grep\s.*-r\b(?!.*\s\S+\s*$)/.test(c) || /^grep\s+-r\b/.test(c))
      reason = "recursive grep without explicit scope";
    else if (/^ls\s.*-[a-zA-Z]*R/.test(c) || /^ls\s+-R\b/.test(c)) reason = "recursive ls";
    else if (/^tree\b(?!.*--depth\b)(?!.*-L\b)/.test(c)) reason = "tree without depth limit";
    if (reason) ctxHits.push({ time: l.time, cmd: c, reason });
  }

  return {
    label,
    totalCommands: lines.length,
    data: {
      groups,
      globalMax,
      projects,
      projectMax,
      securityFlags,
      repeated,
      topSessions,
      totalSessions,
      ctxHits,
    },
  };
}

// --- renderAudit (pure rendering stage) -----------------------------------

function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * Render an `AuditModel` to a human-readable string.
 * Mirrors the exact output of the original `analyze()` function.
 */
export function renderAudit(model: AuditModel): string {
  const lines: string[] = [];

  if (model.data === null) {
    lines.push(`  ${model.label}: no data`);
    return lines.join("\n");
  }

  const { data } = model;
  lines.push(`  ${model.label} (${model.totalCommands} commands)`);

  // Command groups
  for (const group of data.groups) {
    lines.push("");
    lines.push(
      `  ${padRight(group.name, 24)}  ${padBar(group.count, data.globalMax, 12)}  ${group.count}`,
    );
    for (const d of group.details) {
      lines.push(`    ${padRight(d.name, 22)}  ${padBar(d.count, group.detailMax, 8)}  ${d.count}`);
    }
  }

  // Project distribution
  if (data.projects.length > 0) {
    lines.push("");
    lines.push("  projects");
    for (const p of data.projects) {
      lines.push(`    ${padRight(p.name, 22)}  ${padBar(p.count, data.projectMax, 8)}  ${p.count}`);
    }
  }

  // Security scan
  lines.push("");
  if (data.securityFlags.length > 0) {
    lines.push(`  ⚠ security (${data.securityFlags.length} flags)`);
    for (const f of data.securityFlags.slice(0, 10)) {
      lines.push(`    [${f.time}] ${f.desc}`);
      lines.push(`           ${f.cmd.slice(0, 70)}`);
    }
  } else {
    lines.push("  ✓ no security concerns");
  }

  // Repeated commands
  if (data.repeated.length > 0) {
    lines.push("");
    lines.push("  ↻ repeated (optimization candidates)");
    for (const r of data.repeated) {
      lines.push(`    ${r.count}x  ${r.cmd.slice(0, 55)}`);
    }
  }

  // Sessions
  if (data.topSessions.length > 0) {
    lines.push("");
    lines.push(`  ⏱ sessions (${data.totalSessions} total, 15-min idle threshold)`);
    const smax = data.topSessions[0]?.count ?? 0;
    for (const s of data.topSessions) {
      const dur = s.durationMs >= 0 ? fmtDuration(s.durationMs) : "< 1m";
      const bar = padBar(s.count, smax, 8);
      lines.push(`    ${s.start}  ${bar}  ${s.count} cmds  ${dur}  ${padRight(s.domProject, 20)}`);
    }
  }

  // Context-heavy ops
  if (data.ctxHits.length > 0) {
    const ctxMax = data.ctxHits.length;
    lines.push("");
    lines.push(`  📄 context-heavy ops (${data.ctxHits.length})`);
    const bar = padBar(data.ctxHits.length, ctxMax > 0 ? ctxMax : 1, 8);
    lines.push(`    ${bar}  ${data.ctxHits.length} total`);
    for (const h of data.ctxHits.slice(0, 5)) {
      lines.push(`    [${h.time}] ${h.reason}`);
      lines.push(`           ${h.cmd.slice(0, 65)}`);
    }
    lines.push(
      `    → ${data.ctxHits.length} context-heavy op${data.ctxHits.length === 1 ? "" : "s"}; prefer Read/Grep tools or scope these to specific paths`,
    );
  }

  return lines.join("\n");
}

// --- Main -----------------------------------------------------------------

function weekdayIdx(d: Date): number {
  // Bash `date +%u` is 1..7 Monday..Sunday. JS getDay is 0..6 Sunday..Saturday.
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function main(): void {
  const now = new Date();
  const today = ymd(now);
  const header = now.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  console.log(`🔍 Claude Audit · ${header}`);
  console.log("");

  console.log(renderAudit(analyzeCommands("Today", [join(LOG_DIR, `bash-${today}.log`)])));

  // Week: Monday through today.
  const dow = weekdayIdx(now);
  const weekFiles: string[] = [];
  for (let d = 0; d < 7; d++) {
    const dt = new Date(now);
    dt.setDate(now.getDate() - (dow - 1) + d);
    const key = ymd(dt);
    if (key > today) continue;
    const f = join(LOG_DIR, `bash-${key}.log`);
    if (existsSync(f)) weekFiles.push(f);
  }
  if (weekFiles.length > 1) {
    console.log("");
    console.log(renderAudit(analyzeCommands("This week", weekFiles)));
  }
  console.log("");
}

main();
