// Tests for knowledge-index.ts — covers the two pure exported functions.
// No network, no real cache I/O.

import { describe, expect, test } from "bun:test";
import { isStale, parseIndexMarkdown } from "../src/lib/knowledge-index.ts";

// ── parseIndexMarkdown ──────────────────────────────────────────────────────────

describe("parseIndexMarkdown", () => {
  test("parses a line with a tags suffix", () => {
    const md =
      "- [gotcha: drizzle-push-sqlite-not-null-column-truncates](drizzle-push-sqlite-not-null-column-truncates.md) — **What happened.** On theca (2026-09-02), `drizzle-kit push` against the prod... · tags: drizzle, sqlite, turso, migrations, production";
    expect(parseIndexMarkdown(md)).toEqual([
      {
        kind: "gotcha",
        name: "drizzle-push-sqlite-not-null-column-truncates",
        hook: "**What happened.** On theca (2026-09-02), `drizzle-kit push` against the prod...",
        tags: ["drizzle", "sqlite", "turso", "migrations", "production"],
      },
    ]);
  });

  test("parses a second real-format line (convention kind)", () => {
    const md =
      "- [convention: testflight-beta-versioning-and-eas-distribution](testflight-beta-versioning-and-eas-distribution.md) — TestFlight treats the marketing version string as the unit of Beta App Review... · tags: ios, testflight, expo, eas, release";
    const [note] = parseIndexMarkdown(md);
    expect(note?.kind).toBe("convention");
    expect(note?.name).toBe("testflight-beta-versioning-and-eas-distribution");
    expect(note?.tags).toEqual(["ios", "testflight", "expo", "eas", "release"]);
    expect(note?.hook).toBe(
      "TestFlight treats the marketing version string as the unit of Beta App Review...",
    );
  });

  test("tolerates a line with no tags suffix — tags is []", () => {
    const md = "- [gotcha: no-tags-example](no-tags-example.md) — This note has no tags at all";
    expect(parseIndexMarkdown(md)).toEqual([
      {
        kind: "gotcha",
        name: "no-tags-example",
        hook: "This note has no tags at all",
        tags: [],
      },
    ]);
  });

  test("skips malformed lines (missing link, plain text, headers)", () => {
    const md = [
      "# Index",
      "",
      "Some plain paragraph text.",
      "- not a link at all",
      "- [gotcha: real-note](real-note.md) — a real hook · tags: a, b",
    ].join("\n");
    expect(parseIndexMarkdown(md)).toEqual([
      { kind: "gotcha", name: "real-note", hook: "a real hook", tags: ["a", "b"] },
    ]);
  });

  test("returns [] for an empty document", () => {
    expect(parseIndexMarkdown("")).toEqual([]);
  });

  test("hook text keeps its own punctuation/backticks intact", () => {
    const md = "- [gotcha: foo](foo.md) — Contains a colon: and a dash - and `code` too · tags: x";
    const [note] = parseIndexMarkdown(md);
    expect(note?.hook).toBe("Contains a colon: and a dash - and `code` too");
  });

  test("parses multiple lines in one document", () => {
    const md = [
      "- [gotcha: alpha](alpha.md) — hook one · tags: a",
      "- [convention: beta](beta.md) — hook two",
    ].join("\n");
    expect(parseIndexMarkdown(md)).toEqual([
      { kind: "gotcha", name: "alpha", hook: "hook one", tags: ["a"] },
      { kind: "convention", name: "beta", hook: "hook two", tags: [] },
    ]);
  });
});

// ── isStale ────────────────────────────────────────────────────────────────────

describe("isStale", () => {
  test("undefined → stale", () => {
    expect(isStale(undefined)).toBe(true);
  });

  test("garbage string → stale", () => {
    expect(isStale("not-a-date")).toBe(true);
  });

  test("epoch (very old) → stale", () => {
    expect(isStale(new Date(0).toISOString())).toBe(true);
  });

  test("fresh timestamp (just now) → not stale", () => {
    expect(isStale(new Date().toISOString())).toBe(false);
  });

  test("timestamp 5 hours ago → not stale (TTL is 6h)", () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    expect(isStale(fiveHoursAgo)).toBe(false);
  });

  test("timestamp 7 hours ago → stale (TTL is 6h)", () => {
    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    expect(isStale(sevenHoursAgo)).toBe(true);
  });

  test("empty string → stale (Date.parse returns NaN)", () => {
    expect(isStale("")).toBe(true);
  });
});
