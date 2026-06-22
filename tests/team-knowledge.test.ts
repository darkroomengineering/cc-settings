// Tests for teamKnowledgeAwareness — the SessionStart awareness block for the
// shared team-knowledge corpus. Verifies fail-open behavior, exclusions, and
// the label/count format the lib emits.

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { teamKnowledgeAwareness } from "../src/lib/team-knowledge.ts";

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-tk-"));
}

describe("teamKnowledgeAwareness — no-op cases", () => {
  test("returns [] when no clone is configured and the cache is empty", async () => {
    // undefined repoPath falls through to Branch B (the TTL cache). Inject a
    // null reader so the test is isolated from this machine's real
    // ~/.claude/tmp/knowledge-index.json — passing undefined alone does NOT
    // bypass the cache, it triggers the cache read.
    const result = await teamKnowledgeAwareness(undefined, async () => null);
    expect(result).toEqual([]);
  });

  test("returns [] for a non-existent path", async () => {
    const result = await teamKnowledgeAwareness("/tmp/definitely-does-not-exist-cc-tk-xyz");
    expect(result).toEqual([]);
  });

  test("returns [] when dir contains only excluded meta files", async () => {
    const dir = await sandbox();
    try {
      await writeFile(join(dir, "README.md"), "# Readme");
      await writeFile(join(dir, "INDEX.md"), "# Index");
      await writeFile(join(dir, "CONTRIBUTING.md"), "# Contributing");
      const result = await teamKnowledgeAwareness(dir);
      expect(result).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("teamKnowledgeAwareness — explicit repoPath bypasses cache", () => {
  test("explicit repoPath uses local clone, not the TTL cache", async () => {
    // Even if KNOWLEDGE_REPO_PATH is unset and the cache is cold, an explicit
    // repoPath argument drives the local-clone code path (Branch A).
    const dir = await sandbox();
    try {
      await writeFile(join(dir, "concept.md"), "# Concept");
      const result = await teamKnowledgeAwareness(dir);
      // Output must reference the local path (clone branch), not just a count.
      expect(result.join("\n")).toContain(dir);
      expect(result.join("\n")).toContain("1 shared note");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("teamKnowledgeAwareness — TTL cache fallback (Branch B)", () => {
  test("no clone configured → surfaces the injected cache's note count", async () => {
    // The injected reader stands in for ~/.claude/tmp/knowledge-index.json.
    const result = await teamKnowledgeAwareness(undefined, async () => ({
      notes: ["alpha", "beta", "gamma"],
      checkedAt: "2026-01-01T00:00:00.000Z",
    }));
    const text = result.join("\n");
    expect(text).toContain("3 shared notes");
    expect(text).toContain("consult before architecture");
  });
});

describe("teamKnowledgeAwareness — non-empty corpus", () => {
  test("1 note → output contains 'shared note' (singular) and the repo path", async () => {
    const dir = await sandbox();
    try {
      await writeFile(join(dir, "foo.md"), "# Foo note");
      await writeFile(join(dir, "INDEX.md"), "# Index");
      const result = await teamKnowledgeAwareness(dir);
      expect(result.length).toBeGreaterThan(0);
      const text = result.join("\n");
      expect(text).toContain("1 shared note");
      expect(text).toContain(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("3 notes → output contains '3 shared notes' (plural) and the count", async () => {
    const dir = await sandbox();
    try {
      await writeFile(join(dir, "foo.md"), "# Foo");
      await writeFile(join(dir, "bar.md"), "# Bar");
      await writeFile(join(dir, "baz.md"), "# Baz");
      const result = await teamKnowledgeAwareness(dir);
      expect(result.length).toBeGreaterThan(0);
      const text = result.join("\n");
      expect(text).toContain("3 shared notes");
      expect(text).toContain(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
