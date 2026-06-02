#!/usr/bin/env bun
// CLI for the hook auditor. Reads ~/.claude/settings.json (or the path passed
// as the first arg), classifies every hook command, and exits non-zero if
// anything looks like supply-chain compromise.
//
// Usage:
//   bun run audit:hooks                  # audits ~/.claude/settings.json
//   bun src/scripts/audit-hooks.ts <path>

import { resolve } from "node:path";
import { auditSettingsFile, formatAuditReport, hasSuspicious } from "../lib/audit-hooks.ts";

async function main(): Promise<number> {
  const arg = process.argv[2];
  const path = arg ? resolve(arg) : undefined;
  const result = await auditSettingsFile(path);
  console.log(formatAuditReport(result));
  return hasSuspicious(result) ? 1 : 0;
}

process.exit(await main());
