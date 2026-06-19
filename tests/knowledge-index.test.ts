// Tests for knowledge-index.ts — covers the two pure exported functions.
// No network, no real cache I/O.

import { describe, expect, test } from "bun:test";
import { isStale, parseContentsListing } from "../src/lib/knowledge-index.ts";

// ── parseContentsListing ───────────────────────────────────────────────────────

describe("parseContentsListing", () => {
  test("drops entries with type !== 'file'", () => {
    const entries = [
      { name: "notes", type: "dir" },
      { name: "foo.md", type: "file" },
    ];
    expect(parseContentsListing(entries)).toEqual(["foo"]);
  });

  test("drops entries whose name does not end with .md", () => {
    const entries = [
      { name: "foo.ts", type: "file" },
      { name: "bar.json", type: "file" },
      { name: "baz.md", type: "file" },
    ];
    expect(parseContentsListing(entries)).toEqual(["baz"]);
  });

  test("drops NON_NOTE_FILES (README.md, INDEX.md, CONTRIBUTING.md)", () => {
    const entries = [
      { name: "README.md", type: "file" },
      { name: "INDEX.md", type: "file" },
      { name: "CONTRIBUTING.md", type: "file" },
      { name: "gotcha.md", type: "file" },
    ];
    expect(parseContentsListing(entries)).toEqual(["gotcha"]);
  });

  test("strips .md suffix → returns slug", () => {
    const entries = [{ name: "my-note.md", type: "file" }];
    expect(parseContentsListing(entries)).toEqual(["my-note"]);
  });

  test("returns slugs sorted alphabetically", () => {
    const entries = [
      { name: "zebra.md", type: "file" },
      { name: "apple.md", type: "file" },
      { name: "mango.md", type: "file" },
    ];
    expect(parseContentsListing(entries)).toEqual(["apple", "mango", "zebra"]);
  });

  test("returns [] for an empty listing", () => {
    expect(parseContentsListing([])).toEqual([]);
  });

  test("returns [] when listing has only dirs and non-.md files", () => {
    const entries = [
      { name: "README.md", type: "file" },
      { name: "scripts", type: "dir" },
      { name: "config.json", type: "file" },
    ];
    expect(parseContentsListing(entries)).toEqual([]);
  });

  test("mixed realistic listing", () => {
    const entries = [
      { name: "README.md", type: "file" },
      { name: "INDEX.md", type: "file" },
      { name: "CONTRIBUTING.md", type: "file" },
      { name: "scripts", type: "dir" },
      { name: "deployment.md", type: "file" },
      { name: "auth-patterns.md", type: "file" },
      { name: ".github", type: "dir" },
    ];
    expect(parseContentsListing(entries)).toEqual(["auth-patterns", "deployment"]);
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
