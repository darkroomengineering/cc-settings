#!/usr/bin/env bun
// PostToolUse Bash hook — log every Bash command to a daily file under ~/.claude/logs.
// Port of scripts/log-bash.sh.
//
// Reads the hook JSON from stdin (tool_input.command), not from env. Prunes
// logs older than CLAUDE_LOG_RETENTION_DAYS (default 1).

import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const LOG_DIR = join(homedir(), ".claude", "logs");
const RETENTION = Number.parseInt(process.env.CLAUDE_LOG_RETENTION_DAYS ?? "1", 10) || 1;

function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  return new Promise((resolve, reject) => {
    process.stdin.on("data", (c) => chunks.push(c as Uint8Array));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function hms(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function pruneOldLogs(): Promise<void> {
  // Bash used `find ... -mtime +$RETENTION -delete`. Mirror that: delete any
  // bash-*.log whose mtime is older than RETENTION days from now.
  const cutoff = Date.now() - RETENTION * 24 * 60 * 60 * 1000;
  let entries: string[];
  try {
    entries = await readdir(LOG_DIR);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((f) => /^bash-.*\.log$/.test(f))
      .map(async (f) => {
        const p = join(LOG_DIR, f);
        try {
          const st = await stat(p);
          if (st.mtimeMs < cutoff) await unlink(p);
        } catch {
          // ignore
        }
      }),
  );
}

type HookInput = { tool_input?: { command?: string } };

await mkdir(LOG_DIR, { recursive: true }).catch(() => {});
await pruneOldLogs();

const raw = await readStdin();
let parsed: HookInput = {};
try {
  parsed = JSON.parse(raw) as HookInput;
} catch {
  // fall through; no command to log
}
const command = parsed.tool_input?.command ?? "";
if (!command) process.exit(0);

const now = new Date();
const project = basename(process.cwd());
const line = `[${hms(now)}] [${project}] ${command}\n`;
const target = join(LOG_DIR, `bash-${ymd(now)}.log`);
await appendFile(target, line).catch(() => {});
