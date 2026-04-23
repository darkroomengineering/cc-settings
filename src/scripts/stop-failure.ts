#!/usr/bin/env bun
// StopFailure hook — fires when a turn ends due to API error (rate limits, timeouts).
// Port of scripts/stop-failure.sh.
//
// Reads hook JSON from stdin, logs the failure, and surfaces to the user.

import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readStdin } from "../lib/io.ts";

const LOG_FILE = join(homedir(), ".claude", "api-failures.log");

type StopFailureInput = {
  error?: {
    type?: string;
    message?: string;
  };
};

function formatTimestamp(d: Date): string {
  // Bash parity: `date '+%Y-%m-%d %H:%M:%S'` — local time, space separator.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const raw = await readStdin();
let input: StopFailureInput = {};
try {
  input = JSON.parse(raw) as StopFailureInput;
} catch {
  // Malformed stdin — same as bash `jq ... // "unknown"`: keep defaults.
}

const errorType = input.error?.type ?? "unknown";
const errorMessage = input.error?.message ?? "Unknown error";
const timestamp = formatTimestamp(new Date());

await appendFile(LOG_FILE, `[${timestamp}] type=${errorType} msg=${errorMessage}\n`).catch(() => {
  // Never fail the hook on log write.
});

if (/rate.limit|429|capacity|overloaded/i.test(errorMessage)) {
  console.log(`[StopFailure] Rate limit hit at ${timestamp}. Consider:`);
  console.log("  - Using /effort low for simple tasks");
  console.log("  - Delegating more work to sonnet-based agents");
  console.log("  - Waiting a few minutes before retrying");
} else {
  console.log(`[StopFailure] API error at ${timestamp}: ${errorType}`);
}
