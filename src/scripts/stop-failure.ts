#!/usr/bin/env bun
// StopFailure hook — fires when a turn ends due to API error (rate limits, timeouts).
// Port of scripts/stop-failure.sh.
//
// Reads hook JSON from stdin, logs the failure, and surfaces to the user.

import { appendFile } from "node:fs/promises";
import { readHookInput } from "../lib/hook-runtime.ts";
import { claudePath, localDatetime } from "../lib/platform.ts";

const LOG_FILE = claudePath("api-failures.log");

type StopFailureInput = {
  error?: {
    type?: string;
    message?: string;
  };
};

const input = await readHookInput<StopFailureInput>();

const errorType = input.error?.type ?? "unknown";
const errorMessage = input.error?.message ?? "Unknown error";
const timestamp = localDatetime();

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
