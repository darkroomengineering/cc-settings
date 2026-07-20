#!/usr/bin/env bun
// PostToolUse Bash hook — log every Bash command to a daily file under ~/.claude/logs.
// Port of scripts/log-bash.sh.
//
// Reads the hook JSON from stdin (tool_input.command), not from env. Prunes
// logs older than CLAUDE_LOG_RETENTION_DAYS (default 1).

import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { basename } from "node:path";
import { sanitizeOutput } from "../lib/codex.ts";
import { intEnv } from "../lib/hook-config.ts";
import { readHookInput } from "../lib/hook-runtime.ts";
import { claudePath, localDatetime, ymd } from "../lib/platform.ts";
import { redactSecrets } from "../lib/redact.ts";

const LOG_DIR = claudePath("logs");

// An explicit CLAUDE_LOG_RETENTION_DAYS=0 must stay 0 (delete everything on
// every prune), not silently coerce back to the 1-day default — see M19 in
// docs/audits/codebase-audit-2026-07-08.md.
const RETENTION = intEnv("CLAUDE_LOG_RETENTION_DAYS", 1);

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
 * the log file. Secret redaction runs via the canonical redactSecrets
 * (src/lib/redact.ts) — this is the highest-exposure logging surface (every
 * Bash command, not just blocked ones), so it must never fall back to a
 * weaker pattern set than safety-net.ts's. sanitizeOutput already applies
 * redactSecrets internally; the explicit second call here is a deliberate
 * belt-and-suspenders import (idempotent — a no-op on already-redacted text)
 * so this file's own coverage doesn't silently regress if codex.ts's
 * internals ever change. See M23 in docs/audits/codebase-audit-2026-07-08.md.
 */
function escapeForLog(s: string): string {
  return redactSecrets(sanitizeOutput(s))
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r");
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
