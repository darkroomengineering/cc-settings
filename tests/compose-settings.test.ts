// composeSettings tests. Locks in:
//   - numeric-prefix uniqueness (the new assertion)
//   - rejection of unprefixed fragments
//   - ordering by numeric value (not alphabetical) so 10-* and 100-* compose correctly
//   - real repo's config/ composes today (dogfood)

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { composeSettings } from "../src/lib/compose-settings.ts";

const ROOT = resolve(import.meta.dir, "..");

async function sandbox(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cc-compose-"));
  await mkdir(join(dir, "config"));
  return dir;
}

async function writeFragment(
  dir: string,
  name: string,
  content: Record<string, unknown>,
): Promise<void> {
  await writeFile(join(dir, "config", name), JSON.stringify(content));
}

describe("composeSettings — repo dogfood", () => {
  test("real config/ composes cleanly today", async () => {
    const out = await composeSettings(ROOT);
    expect(typeof out).toBe("object");
    expect(out).not.toBeNull();
  });
});

describe("composeSettings — naming contract", () => {
  test("rejects fragment without numeric prefix", async () => {
    const dir = await sandbox();
    try {
      await writeFragment(dir, "extra.json", { foo: 1 });
      await expect(composeSettings(dir)).rejects.toThrow(/no numeric prefix/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects two fragments with the same numeric prefix", async () => {
    const dir = await sandbox();
    try {
      await writeFragment(dir, "10-core.json", { env: { A: "1" } });
      await writeFragment(dir, "10-extra.json", { env: { B: "2" } });
      await expect(composeSettings(dir)).rejects.toThrow(/collides.*numeric prefix 10/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects 010-foo.json + 10-foo.json (both numerically 10)", async () => {
    const dir = await sandbox();
    try {
      await writeFragment(dir, "010-a.json", { a: 1 });
      await writeFragment(dir, "10-b.json", { b: 2 });
      await expect(composeSettings(dir)).rejects.toThrow(/collides.*numeric prefix 10/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("composeSettings — ordering", () => {
  test("orders by numeric value, not alphabetical (10-* before 100-*)", async () => {
    // Alphabetical sort would put 100-* before 10-* (ASCII: '0' < '-').
    // Numeric sort puts 10-* first. Verify the LATER (100) wins on conflicts.
    const dir = await sandbox();
    try {
      await writeFragment(dir, "10-low.json", { val: "first" });
      await writeFragment(dir, "100-high.json", { val: "later-wins" });
      const merged = await composeSettings(dir);
      expect(merged.val).toBe("later-wins");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("later prefix overrides earlier on top-level key conflict", async () => {
    const dir = await sandbox();
    try {
      await writeFragment(dir, "10-base.json", { model: "opus" });
      await writeFragment(dir, "20-override.json", { model: "sonnet" });
      const merged = await composeSettings(dir);
      expect(merged.model).toBe("sonnet");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("composeSettings — content errors", () => {
  test("rejects malformed JSON", async () => {
    const dir = await sandbox();
    try {
      await writeFile(join(dir, "config", "10-bad.json"), "{not json");
      await expect(composeSettings(dir)).rejects.toThrow(/not valid JSON/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects array at top level", async () => {
    const dir = await sandbox();
    try {
      await writeFile(join(dir, "config", "10-arr.json"), "[1, 2, 3]");
      await expect(composeSettings(dir)).rejects.toThrow(/JSON object at the top level/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects null at top level", async () => {
    const dir = await sandbox();
    try {
      await writeFile(join(dir, "config", "10-null.json"), "null");
      await expect(composeSettings(dir)).rejects.toThrow(/JSON object at the top level/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("composeSettings — empty / missing", () => {
  test("rejects missing config/", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-compose-"));
    try {
      await expect(composeSettings(dir)).rejects.toThrow(/config\/ not found/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects empty config/", async () => {
    const dir = await sandbox();
    try {
      await expect(composeSettings(dir)).rejects.toThrow(/contains no \.json fragments/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
