// Unit tests for src/lib/session-model.ts (pure helpers) plus an e2e check of
// statusline.ts's write-on-change wiring — same pattern as
// tests/version-drift.test.ts's refreshSessionInstallMap coverage, since
// session-model.ts mirrors that module's schema+refresh+IO split exactly.

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  readSessionModel,
  refreshSessionModelMap,
  SESSION_MODEL_MAP_CAP,
} from "../src/lib/session-model.ts";

const STATUSLINE = resolve(import.meta.dir, "../src/hooks/statusline.ts");

describe("refreshSessionModelMap", () => {
  test("records a new session with the given model", () => {
    const out = refreshSessionModelMap({}, "s1", "Opus 5", 1000);
    expect(out).toEqual({ s1: { m: "Opus 5", t: 1000 } });
  });

  test("refreshes an existing entry to a new model", () => {
    const prior = { s1: { m: "Opus 5", t: 1 } };
    const out = refreshSessionModelMap(prior, "s1", "Fable 5", 2000);
    expect(out).toEqual({ s1: { m: "Fable 5", t: 2000 } });
  });

  test("prunes to SESSION_MODEL_MAP_CAP most recently updated entries, keeping the refreshed one", () => {
    const map: Record<string, { m: string; t: number }> = {};
    for (let i = 0; i < SESSION_MODEL_MAP_CAP + 5; i++) map[`s${i}`] = { m: "Opus 5", t: i };
    const out = refreshSessionModelMap(map, "fresh", "Fable 5", 10_000);
    expect(Object.keys(out).length).toBe(SESSION_MODEL_MAP_CAP);
    expect(out.fresh).toEqual({ m: "Fable 5", t: 10_000 });
    // Oldest entries were dropped.
    expect(out.s0).toBeUndefined();
    expect(out.s4).toBeUndefined();
  });

  test("does not mutate the input map", () => {
    const input = { s1: { m: "Opus 5", t: 1 } };
    refreshSessionModelMap(input, "s1", "Fable 5", 2000);
    expect(input.s1.m).toBe("Opus 5");
  });
});

describe("readSessionModel", () => {
  // Points readSessionModel at a fixture directory via its optional tmpDir
  // param — NOT process.env.HOME, which platform.ts's CLAUDE_DIR resolves
  // once at module-import time, so mutating it post-import has no effect on
  // hook-runtime.ts's TMP_DIR and would silently fall through to the real
  // ~/.claude/tmp instead of the fixture.
  async function withFixture(fn: (dir: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "cc-session-model-"));
    try {
      await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("missing state file → null", async () => {
    await withFixture(async (dir) => {
      expect(await readSessionModel("s1", dir)).toBeNull();
    });
  });

  test("valid entry → returns the recorded model", async () => {
    await withFixture(async (dir) => {
      await writeFile(
        join(dir, "session-models.json"),
        JSON.stringify({ s1: { m: "Fable 5", t: 123 } }),
      );
      expect(await readSessionModel("s1", dir)).toBe("Fable 5");
    });
  });

  test("no entry for this session id → null", async () => {
    await withFixture(async (dir) => {
      await writeFile(
        join(dir, "session-models.json"),
        JSON.stringify({ other: { m: "Fable 5", t: 123 } }),
      );
      expect(await readSessionModel("s1", dir)).toBeNull();
    });
  });

  test("corrupt JSON → falls back to null, never throws", async () => {
    await withFixture(async (dir) => {
      await writeFile(join(dir, "session-models.json"), "{not json");
      expect(await readSessionModel("s1", dir)).toBeNull();
    });
  });

  test("well-formed but wrong shape (schema mismatch) → falls back to null", async () => {
    await withFixture(async (dir) => {
      await writeFile(join(dir, "session-models.json"), JSON.stringify({ s1: "Fable 5" }));
      expect(await readSessionModel("s1", dir)).toBeNull();
    });
  });
});

describe("statusline.ts — session-model write-on-change wiring (e2e)", () => {
  function payload(sessionId: string, displayName: string): Record<string, unknown> {
    return {
      session_id: sessionId,
      model: { display_name: displayName },
      workspace: { current_dir: "/tmp" },
    };
  }

  async function runStatusline(home: string, input: Record<string, unknown>): Promise<void> {
    const proc = Bun.spawn(["bun", STATUSLINE], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
    await new Response(proc.stdout).text();
    await proc.exited;
  }

  test("same model twice → one entry recorded, second render is a no-op write", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-statusline-session-model-"));
    try {
      await runStatusline(home, payload("sess-1", "Opus 5"));
      const stateFile = join(home, ".claude", "tmp", "session-models.json");
      const firstMap = JSON.parse(await readFile(stateFile, "utf8"));
      expect(firstMap["sess-1"].m).toBe("Opus 5");
      const mtimeAfterFirst = (await stat(stateFile)).mtimeMs;

      // Re-render with the SAME model — write-on-change must skip the write
      // entirely, so the file's mtime should not move.
      await runStatusline(home, payload("sess-1", "Opus 5"));
      const mtimeAfterSecond = (await stat(stateFile)).mtimeMs;
      expect(mtimeAfterSecond).toBe(mtimeAfterFirst);

      const secondMap = JSON.parse(await readFile(stateFile, "utf8"));
      expect(Object.keys(secondMap).length).toBe(1);
      expect(secondMap["sess-1"].m).toBe("Opus 5");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("changed model → entry is updated", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-statusline-session-model-"));
    try {
      await runStatusline(home, payload("sess-1", "Opus 5"));
      await runStatusline(home, payload("sess-1", "Fable 5"));
      const stateFile = join(home, ".claude", "tmp", "session-models.json");
      const map = JSON.parse(await readFile(stateFile, "utf8"));
      expect(map["sess-1"].m).toBe("Fable 5");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
