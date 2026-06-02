// Version delta helper — pure parsing/formatting tests. The only IO is
// reading the sentinel file, covered with a tmp dir.

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildVersionDelta,
  type ChangelogEntry,
  compareVersion,
  entriesBetween,
  formatVersionDelta,
  parseChangelogEntries,
  readInstalledVersion,
} from "../src/lib/version-delta.ts";

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-vd-"));
}

describe("compareVersion", () => {
  test("equal", () => expect(compareVersion("10.5.1", "10.5.1")).toBe(0));
  test("major bump", () => expect(compareVersion("11.0.0", "10.99.99")).toBeGreaterThan(0));
  test("minor bump", () => expect(compareVersion("10.5.0", "10.4.99")).toBeGreaterThan(0));
  test("patch bump", () => expect(compareVersion("10.5.1", "10.5.0")).toBeGreaterThan(0));
  test("downgrade returns negative", () =>
    expect(compareVersion("10.4.1", "10.5.0")).toBeLessThan(0));
  test("does NOT do lex compare (10 > 9)", () =>
    expect(compareVersion("10.0.0", "9.99.99")).toBeGreaterThan(0));
});

describe("readInstalledVersion", () => {
  test("returns null on missing sentinel", async () => {
    const dir = await sandbox();
    try {
      expect(await readInstalledVersion(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reads version field from sentinel JSON", async () => {
    const dir = await sandbox();
    try {
      await writeFile(
        join(dir, ".cc-settings-version"),
        JSON.stringify({ version: "10.4.1", installed_at: "2026-05-04T00:00:00Z" }),
      );
      expect(await readInstalledVersion(dir)).toBe("10.4.1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns null on malformed sentinel (no throw)", async () => {
    const dir = await sandbox();
    try {
      await writeFile(join(dir, ".cc-settings-version"), "{not valid json");
      expect(await readInstalledVersion(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns null when version field is missing", async () => {
    const dir = await sandbox();
    try {
      await writeFile(
        join(dir, ".cc-settings-version"),
        JSON.stringify({ installed_at: "2026-05-04T00:00:00Z" }),
      );
      expect(await readInstalledVersion(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("parseChangelogEntries", () => {
  test("extracts version + date + title from h2 + h3 pattern", () => {
    const text = `# Changelog

## [10.5.1] — 2026-05-04

### docs: MANUAL.md Day-1 Quickstart

Replaced the install-only header...

## [10.5.0] — 2026-05-04

### IDE IntelliSense — published JSON schemas at GitHub raw

Body text.

## [10.4.1] — 2026-05-04

### Fix: statusline missing for pre-v10 upgraders

Some users were...
`;
    const entries = parseChangelogEntries(text);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      version: "10.5.1",
      date: "2026-05-04",
      title: "docs: MANUAL.md Day-1 Quickstart",
    });
    expect(entries[1]?.title).toBe("IDE IntelliSense — published JSON schemas at GitHub raw");
    expect(entries[2]?.title).toBe("Fix: statusline missing for pre-v10 upgraders");
  });

  test("handles version heading without h3 — uses next non-empty line as title", () => {
    const text = `## [9.0.0] — 2026-01-01

Plain paragraph title here.

More body.

## [8.0.0] — 2025-12-01

Another title.`;
    const entries = parseChangelogEntries(text);
    expect(entries[0]).toEqual({
      version: "9.0.0",
      date: "2026-01-01",
      title: "Plain paragraph title here.",
    });
    expect(entries[1]?.title).toBe("Another title.");
  });

  test("empty changelog → no entries", () => {
    expect(parseChangelogEntries("# Changelog\n\nNothing yet.")).toEqual([]);
  });
});

describe("entriesBetween", () => {
  const fixture: ChangelogEntry[] = [
    { version: "10.5.1", date: "", title: "C" },
    { version: "10.5.0", date: "", title: "B" },
    { version: "10.4.1", date: "", title: "A" },
    { version: "10.4.0", date: "", title: "Z" },
  ];

  test("from exclusive, to inclusive", () => {
    const got = entriesBetween(fixture, "10.4.1", "10.5.1");
    expect(got.map((e) => e.version)).toEqual(["10.5.1", "10.5.0"]);
  });

  test("same from/to → empty", () => {
    expect(entriesBetween(fixture, "10.4.1", "10.4.1")).toEqual([]);
  });

  test("from above all → empty", () => {
    expect(entriesBetween(fixture, "11.0.0", "12.0.0")).toEqual([]);
  });
});

describe("formatVersionDelta", () => {
  test("first install (prev null)", () => {
    const out = formatVersionDelta({ prev: null, current: "10.5.1", entries: [] });
    expect(out).toBe("cc-settings: first install at v10.5.1");
  });

  test("same version → null", () => {
    expect(formatVersionDelta({ prev: "10.5.1", current: "10.5.1", entries: [] })).toBeNull();
  });

  test("downgrade (rollback) — flagged in message", () => {
    expect(formatVersionDelta({ prev: "10.5.1", current: "10.4.1", entries: [] })).toContain(
      "downgrade",
    );
  });

  test("forward delta with entries — header + bullet per version", () => {
    const out = formatVersionDelta({
      prev: "10.4.1",
      current: "10.5.1",
      entries: [
        { version: "10.5.1", date: "", title: "Quickstart" },
        { version: "10.5.0", date: "", title: "Schemas published" },
      ],
    });
    expect(out).toContain("v10.4.1 → v10.5.1");
    expect(out).toContain("2 version(s) since last install");
    expect(out).toContain("• v10.5.1: Quickstart");
    expect(out).toContain("• v10.5.0: Schemas published");
  });

  test("forward delta with no entries (CHANGELOG out of date) — still prints header", () => {
    const out = formatVersionDelta({
      prev: "10.4.1",
      current: "10.5.1",
      entries: [],
    });
    expect(out).toContain("v10.4.1 → v10.5.1");
    expect(out).toContain("0 version(s)");
  });
});

describe("buildVersionDelta — end-to-end", () => {
  test("real CHANGELOG.md parses cleanly when prev=10.4.1, current=10.5.1", async () => {
    const repoChangelog = join(import.meta.dir, "..", "CHANGELOG.md");
    const out = await buildVersionDelta("10.4.1", "10.5.1", repoChangelog);
    expect(out).toContain("v10.4.1 → v10.5.1");
    // Should pick up the recently-shipped versions.
    expect(out).toContain("v10.5.1");
    expect(out).toContain("v10.5.0");
  });

  test("first install (prev null) returns first-install message", async () => {
    const out = await buildVersionDelta(null, "10.5.1", "/nonexistent/CHANGELOG.md");
    expect(out).toBe("cc-settings: first install at v10.5.1");
  });

  test("missing CHANGELOG → still produces forward-delta header without entries", async () => {
    const out = await buildVersionDelta("10.4.1", "10.5.1", "/nonexistent/CHANGELOG.md");
    expect(out).toContain("v10.4.1 → v10.5.1");
    expect(out).toContain("0 version(s)");
  });
});
