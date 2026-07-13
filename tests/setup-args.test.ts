// parseArgs tests — locks in the flag surface. Imports are safe because
// setup.ts gates main() behind `if (import.meta.main)`.

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseArgs } from "../src/setup.ts";

describe("parseArgs", () => {
  test("defaults — empty argv", () => {
    const a = parseArgs([]);
    expect(a.rollback).toBeNull();
    expect(a.dryRun).toBe(false);
    expect(a.status).toBe(false);
    expect(a.help).toBe(false);
    expect(a.migrateOnly).toBe(false);
    // Not end-anchored: when the suite runs inside a git worktree, sourceDir is
    // `.../cc-settings/.claude/worktrees/agent-<hash>` — still inside the
    // cc-settings project, but not ending in it. A substring check holds in both.
    expect(a.sourceDir).toContain("cc-settings");
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
    // parseArgs resolves the path; assert against the resolved form so this
    // holds on Windows too (resolve("/tmp/cc") → "C:\\tmp\\cc" there).
    expect(a.sourceDir).toBe(resolve("/tmp/cc"));
  });

  test("--help / -h both set help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("flags compose — multiple at once", () => {
    const a = parseArgs(["--migrate-only", "--interactive", "--source=/tmp/x"]);
    expect(a.migrateOnly).toBe(true);
    expect(a.interactive).toBe(true);
    expect(a.sourceDir).toBe(resolve("/tmp/x"));
  });

  test("default profile is 'full'", () => {
    expect(parseArgs([]).profile).toBe("full");
  });

  test("--light sets profile to 'light'", () => {
    expect(parseArgs(["--light"]).profile).toBe("light");
  });

  test("--light composes with --dry-run", () => {
    const a = parseArgs(["--light", "--dry-run"]);
    expect(a.profile).toBe("light");
    expect(a.dryRun).toBe(true);
  });

  test("--light composes with --source", () => {
    const a = parseArgs(["--light", "--source=/tmp/cc"]);
    expect(a.profile).toBe("light");
    expect(a.sourceDir).toBe(resolve("/tmp/cc"));
  });

  test("default autoUpdate is null", () => {
    expect(parseArgs([]).autoUpdate).toBeNull();
  });

  test("--auto-update=on sets autoUpdate to 'on'", () => {
    expect(parseArgs(["--auto-update=on"]).autoUpdate).toBe("on");
  });

  test("--auto-update=off sets autoUpdate to 'off'", () => {
    expect(parseArgs(["--auto-update=off"]).autoUpdate).toBe("off");
  });

  test("--auto-update=<invalid> is ignored — autoUpdate stays null", () => {
    expect(parseArgs(["--auto-update=maybe"]).autoUpdate).toBeNull();
  });

  test("--auto-update composes with other flags", () => {
    const a = parseArgs(["--auto-update=on", "--light", "--dry-run"]);
    expect(a.autoUpdate).toBe("on");
    expect(a.profile).toBe("light");
    expect(a.dryRun).toBe(true);
  });
});
