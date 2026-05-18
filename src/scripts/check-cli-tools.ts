#!/usr/bin/env bun
// Standalone CLI preflight checker.
// Run via: bun src/scripts/check-cli-tools.ts
// Or:      bun run check:cli-tools

import { checkCliTools, printPreflightReport } from "../lib/cli-preflight.ts";
import { success } from "../lib/colors.ts";

function main(): void {
  const result = checkCliTools();
  if (result.missing.length === 0) {
    success("All recommended CLI tools are present.");
  } else {
    printPreflightReport(result);
  }
  process.exit(0);
}

main();
