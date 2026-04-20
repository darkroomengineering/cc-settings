#!/usr/bin/env bun
// Claude bash command audit — categorized command analysis.
// Port of scripts/claude-audit.sh. Reads logs at
// ~/.claude/logs/bash-YYYY-MM-DD.log (format: `[HH:MM:SS] [project] command`).
//
// Invoked as a one-shot from the /audit skill; no hook-protocol concerns.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const LOG_DIR = join(homedir(), ".claude", "logs");

// --- Helpers --------------------------------------------------------------

function padBar(val: number, max: number, width = 12): string {
  const filled = max > 0 ? Math.floor((val * width) / max) : 0;
  return "█".repeat(filled).padEnd(width, " ");
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

function classify(cmd: string): string {
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

// --- Analyze --------------------------------------------------------------

function analyze(label: string, files: string[]): void {
  const lines = parseLines(files);
  if (lines.length === 0) {
    console.log(`  ${label}: no data`);
    return;
  }
  console.log(`  ${label} (${lines.length} commands)`);

  const classified = lines.map((l) => ({ ...l, klass: classify(l.cmd) }));
  const groups = countBy(classified, (v) => v.klass.split(":")[0] ?? "other");
  const sortedGroups = sortDesc(groups);
  const globalMax = sortedGroups[0]?.[1] ?? 0;

  for (const [gname, gcount] of sortedGroups) {
    console.log("");
    console.log(`  ${padRight(gname, 24)}  ${padBar(gcount, globalMax, 12)}  ${gcount}`);
    const details = countBy(
      classified.filter((v) => v.klass.startsWith(`${gname}:`)),
      (v) => v.klass.slice(gname.length + 1),
    );
    const sorted = sortDesc(details);
    const dmax = sorted[0]?.[1] ?? 0;
    for (const [dname, dcount] of sorted.slice(0, 6)) {
      console.log(`    ${padRight(dname, 22)}  ${padBar(dcount, dmax, 8)}  ${dcount}`);
    }
  }

  // Project distribution
  const projects = countBy(lines, (v) => v.project);
  if (projects.size > 0) {
    console.log("");
    console.log("  projects");
    const sorted = sortDesc(projects);
    const pmax = sorted[0]?.[1] ?? 0;
    for (const [name, count] of sorted) {
      console.log(`    ${padRight(name, 22)}  ${padBar(count, pmax, 8)}  ${count}`);
    }
  }

  // Security scan
  type Flag = { time: string; desc: string; cmd: string };
  const flags: Flag[] = [];
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
    if (desc) flags.push({ time: l.time, desc, cmd: c });
  }
  console.log("");
  if (flags.length > 0) {
    console.log(`  ⚠ security (${flags.length} flags)`);
    for (const f of flags.slice(0, 10)) {
      console.log(`    [${f.time}] ${f.desc}`);
      console.log(`           ${f.cmd.slice(0, 70)}`);
    }
  } else {
    console.log("  ✓ no security concerns");
  }

  // Repeated exact commands (3+)
  const repeats = countBy(lines, (v) => v.cmd);
  const repeated = sortDesc(repeats).filter(([, count]) => count >= 3);
  if (repeated.length > 0) {
    console.log("");
    console.log("  ↻ repeated (optimization candidates)");
    for (const [cmd, count] of repeated.slice(0, 5)) {
      console.log(`    ${count}x  ${cmd.slice(0, 55)}`);
    }
  }
}

// --- Main -----------------------------------------------------------------

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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

  analyze("Today", [join(LOG_DIR, `bash-${today}.log`)]);

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
    analyze("This week", weekFiles);
  }
  console.log("");
}

main();
