// `SHORTCUT:` marker validator tests. The load-bearing case is `no-upgrade-trigger`
// — a marker with a ceiling but no trigger is the one that rots (AGENTS.md,
// Laziness Ladder). The self-match cases matter just as much: this linter's own
// source contains the marker text inside regex literals, and an unanchored pattern
// reports the linter as its own debt.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatLedger,
  hasErrors,
  lintShortcutsDir,
  parseShortcuts,
} from "../src/lib/lint-shortcuts.ts";

const complete = `export const cache = new Map();

// SHORTCUT: single global lock, not per-key.
// ceiling: contention above ~50 rps
// upgrade: shard by key hash when p99 write latency climbs
export function lock() {}
`;

describe("parseShortcuts", () => {
  test("parses a complete marker", () => {
    const [marker] = parseShortcuts("a.ts", complete);
    expect(marker?.line).toBe(3);
    expect(marker?.summary).toBe("single global lock, not per-key.");
    expect(marker?.ceiling).toBe("contention above ~50 rps");
    expect(marker?.upgrade).toBe("shard by key hash when p99 write latency climbs");
  });

  test("records a missing upgrade trigger as null", () => {
    const [marker] = parseShortcuts("a.ts", "// SHORTCUT: naive scan\n// ceiling: O(n^2)\n");
    expect(marker?.ceiling).toBe("O(n^2)");
    expect(marker?.upgrade).toBeNull();
  });

  test("supports # and -- comment prefixes", () => {
    expect(parseShortcuts("a.py", "# SHORTCUT: hardcoded limit\n")).toHaveLength(1);
    expect(parseShortcuts("a.sql", "-- SHORTCUT: full table scan\n")).toHaveLength(1);
  });

  test("a second marker ends the first marker's block", () => {
    const text = [
      "// SHORTCUT: first",
      "// SHORTCUT: second",
      "// upgrade: belongs to the second",
    ].join("\n");
    const markers = parseShortcuts("a.ts", text);
    expect(markers).toHaveLength(2);
    expect(markers[0]?.upgrade).toBeNull();
    expect(markers[1]?.upgrade).toBe("belongs to the second");
  });

  test("ignores the marker text mid-expression — the self-match guard", () => {
    // Shape of this linter's own regex literals. Unanchored, these matched.
    const text = 'const M = /(?:\\/\\/|#)\\s*SHORTCUT:\\s*(.*)$/;\nconst s = "SHORTCUT: nope";\n';
    expect(parseShortcuts("a.ts", text)).toHaveLength(0);
  });

  test("ignores a trailing marker after code", () => {
    expect(parseShortcuts("a.ts", "doThing(); // SHORTCUT: not on its own line\n")).toHaveLength(0);
  });
});

describe("lintShortcutsDir", () => {
  async function fixture(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "shortcuts-"));
    for (const [name, body] of Object.entries(files)) {
      const full = join(dir, name);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, body);
    }
    return dir;
  }

  test("a complete marker passes clean", async () => {
    const dir = await fixture({ "src/a.ts": complete });
    const result = await lintShortcutsDir(dir);
    expect(result.findings).toHaveLength(0);
    expect(hasErrors(result)).toBe(false);
    expect(result.markers).toHaveLength(1);
    await rm(dir, { recursive: true, force: true });
  });

  test("a missing upgrade trigger is an error", async () => {
    const dir = await fixture({ "src/a.ts": "// SHORTCUT: naive\n// ceiling: O(n^2)\n" });
    const result = await lintShortcutsDir(dir);
    expect(hasErrors(result)).toBe(true);
    expect(result.findings.map((f) => f.rule)).toContain("no-upgrade-trigger");
    await rm(dir, { recursive: true, force: true });
  });

  test("a missing ceiling is only a warning", async () => {
    const dir = await fixture({ "src/a.ts": "// SHORTCUT: naive\n// upgrade: when it hurts\n" });
    const result = await lintShortcutsDir(dir);
    expect(hasErrors(result)).toBe(false);
    expect(result.findings.map((f) => f.rule)).toEqual(["no-ceiling"]);
    await rm(dir, { recursive: true, force: true });
  });

  test("skips markdown and node_modules", async () => {
    const dir = await fixture({
      "AGENTS.md": "// SHORTCUT: documented in prose\n",
      "node_modules/dep/index.ts": "// SHORTCUT: someone else's debt\n",
    });
    const result = await lintShortcutsDir(dir);
    expect(result.markers).toHaveLength(0);
    await rm(dir, { recursive: true, force: true });
  });

  test("ledger lists no-trigger markers first and counts them", async () => {
    const dir = await fixture({
      "src/a.ts": complete,
      "src/b.ts": "// SHORTCUT: orphan\n// ceiling: unknown\n",
    });
    const ledger = formatLedger(await lintShortcutsDir(dir));
    expect(ledger.indexOf("orphan")).toBeLessThan(ledger.indexOf("single global lock"));
    expect(ledger).toContain("[no-trigger]");
    expect(ledger).toContain("2 markers, 1 with no trigger.");
    await rm(dir, { recursive: true, force: true });
  });

  test("an empty tree reports a clean ledger", async () => {
    const dir = await fixture({ "src/a.ts": "export const x = 1;\n" });
    expect(formatLedger(await lintShortcutsDir(dir))).toBe("No SHORTCUT: debt. Clean ledger.");
    await rm(dir, { recursive: true, force: true });
  });
});
