// Settings baseline snapshot (Phase 1 of the three-way settings-merge design,
// docs/settings-merge-three-way-design.md §1). Write-only in production —
// these tests exist to prove the write/read round-trip works so the data is
// trustworthy whenever a future three-way merge reads it.

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BASELINE_FILENAME,
  readSettingsBaseline,
  writeSettingsBaseline,
} from "../src/lib/settings-baseline.ts";

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-sb-"));
}

describe("writeSettingsBaseline + readSettingsBaseline", () => {
  test("round-trips version, written_at, and settings", async () => {
    const dir = await sandbox();
    try {
      const settings = { hooks: { a: 1 }, permissions: { allow: ["Read(*)"] } };
      await writeSettingsBaseline(dir, "13.0.6", settings);
      const result = await readSettingsBaseline(dir);
      expect(result?.version).toBe("13.0.6");
      expect(typeof result?.written_at).toBe("string");
      expect(result?.settings).toEqual(settings);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns null on missing file", async () => {
    const dir = await sandbox();
    try {
      expect(await readSettingsBaseline(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns null on corrupt JSON", async () => {
    const dir = await sandbox();
    try {
      await writeFile(join(dir, BASELINE_FILENAME), "{not valid json");
      expect(await readSettingsBaseline(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns null on non-object top level (array)", async () => {
    const dir = await sandbox();
    try {
      await writeFile(join(dir, BASELINE_FILENAME), JSON.stringify([1, 2, 3]));
      expect(await readSettingsBaseline(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns null on non-object top level (primitive)", async () => {
    const dir = await sandbox();
    try {
      await writeFile(join(dir, BASELINE_FILENAME), JSON.stringify("just a string"));
      expect(await readSettingsBaseline(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("one bad-typed field degrades that field only, others still read", async () => {
    const dir = await sandbox();
    try {
      // written_at is a number instead of a string — should degrade to
      // undefined while version and settings still parse fine.
      await writeFile(
        join(dir, BASELINE_FILENAME),
        JSON.stringify({
          version: "13.0.6",
          written_at: 12345,
          settings: { foo: "bar" },
        }),
      );
      const result = await readSettingsBaseline(dir);
      expect(result).not.toBeNull();
      expect(result?.version).toBe("13.0.6");
      expect(result?.written_at).toBeUndefined();
      expect(result?.settings).toEqual({ foo: "bar" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("write is atomic — no .tmp residue after successful write", async () => {
    const dir = await sandbox();
    try {
      await writeSettingsBaseline(dir, "13.0.6", { a: 1 });
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(dir);
      expect(entries.some((e) => e.endsWith(".tmp"))).toBe(false);
      expect(entries).toContain(BASELINE_FILENAME);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
