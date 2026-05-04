// parseArgs tests — locks in the flag surface. Imports are safe because
// setup.ts gates main() behind `if (import.meta.main)`.

import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/setup.ts";

describe("parseArgs", () => {
  test("defaults — empty argv", () => {
    const a = parseArgs([]);
    expect(a.rollback).toBeNull();
    expect(a.dryRun).toBe(false);
    expect(a.status).toBe(false);
    expect(a.help).toBe(false);
    expect(a.migrateOnly).toBe(false);
    expect(a.sourceDir).toMatch(/cc-settings$/);
  });

  test("--rollback (no value) sets rollback to true", () => {
    expect(parseArgs(["--rollback"]).rollback).toBe(true);
  });

  test("--rollback=<ts> sets rollback to that string", () => {
    expect(parseArgs(["--rollback=2026-04-20T10-00-00Z"]).rollback).toBe("2026-04-20T10-00-00Z");
  });

  test("--dry-run sets dryRun", () => {
    expect(parseArgs(["--dry-run"]).dryRun).toBe(true);
  });

  test("--status sets status", () => {
    expect(parseArgs(["--status"]).status).toBe(true);
  });

  test("--interactive sets interactive", () => {
    expect(parseArgs(["--interactive"]).interactive).toBe(true);
  });

  test("--migrate-only sets migrateOnly", () => {
    expect(parseArgs(["--migrate-only"]).migrateOnly).toBe(true);
  });

  test("--source=<path> sets sourceDir", () => {
    const a = parseArgs(["--source=/tmp/cc"]);
    expect(a.sourceDir).toBe("/tmp/cc");
  });

  test("--help / -h both set help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("flags compose — multiple at once", () => {
    const a = parseArgs(["--migrate-only", "--interactive", "--source=/tmp/x"]);
    expect(a.migrateOnly).toBe(true);
    expect(a.interactive).toBe(true);
    expect(a.sourceDir).toBe("/tmp/x");
  });
});
