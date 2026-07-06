#!/usr/bin/env bun
// PostToolUse Bash hook — log every Bash command to a daily file under ~/.claude/logs.
// Port of scripts/log-bash.sh.
//
// Reads the hook JSON from stdin (tool_input.command), not from env. Prunes
// logs older than CLAUDE_LOG_RETENTION_DAYS (default 1).

import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { basename } from "node:path";
import { sanitizeOutput } from "../lib/codex.ts";
import { readHookInput } from "../lib/hook-runtime.ts";
import { claudePath, localDatetime, ymd } from "../lib/platform.ts";

const LOG_DIR = claudePath("logs");
const RETENTION = Number.parseInt(process.env.CLAUDE_LOG_RETENTION_DAYS ?? "1", 10) || 1;

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
        const p = claudePath("logs", f);
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

/**
 * Collapse a (possibly multi-line) command into a single physical log line so
 * `claude-audit`'s per-line parser sees the FULL command, not just line 1.
 * Backslashes are escaped first so the reverse mapping in claude-audit.ts is
 * unambiguous, then real newlines/carriage-returns become literal `\n`/`\r`.
 * ANSI/control sequences are stripped via the same sanitizer codex.ts uses for
 * subprocess output, so a hostile command can't smuggle terminal escapes into
 * the log file.
 */
function escapeForLog(s: string): string {
  return sanitizeOutput(s).replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "\\r");
}

await mkdir(LOG_DIR, { recursive: true }).catch(() => {});
await pruneOldLogs();

const parsed = await readHookInput<HookInput>();
const command = parsed.tool_input?.command ?? "";
if (!command) process.exit(0);

const now = new Date();
const project = basename(process.cwd());
// localDatetime gives "YYYY-MM-DD HH:MM:SS"; we only want the HH:MM:SS portion.
const hms = localDatetime(now).slice(11);
const line = `[${hms}] [${project}] ${escapeForLog(command)}\n`;
const target = claudePath("logs", `bash-${ymd(now)}.log`);
await appendFile(target, line).catch(() => {});
