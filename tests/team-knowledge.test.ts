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
  test("returns [] when no path is given (undefined)", async () => {
    // Pass undefined explicitly — function defaults to $KNOWLEDGE_REPO_PATH,
    // but we pass explicit undefined to bypass any real env var.
    const result = await teamKnowledgeAwareness(undefined);
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
