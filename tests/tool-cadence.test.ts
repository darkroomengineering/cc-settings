// Parallelmax branch e2e tests for tool-cadence.ts.
// Uses the same sandboxed-HOME pattern as review-queue.test.ts.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnCapture } from "./support/proc.ts";

const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "tool-cadence.ts");

async function runHook(
  payload: unknown,
  home: string,
  threshold = "3",
): Promise<{ stdout: string; exit: number }> {
  return spawnCapture(["bun", HOOK], {
    env: {
      HOME: home,
      USERPROFILE: home,
      CC_PARALLELMAX_THRESHOLD: threshold,
      // Suppress review-queue nudges during these tests.
      CC_MAX_UNREVIEWED: "100",
    },
    stdin: JSON.stringify(payload),
    stderr: "ignore",
  });
}

async function readCounterState(home: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(
      await readFile(join(home, ".claude", "tmp", "parallelmax-counter.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function writeCounterState(home: string, data: unknown): Promise<void> {
  await mkdir(join(home, ".claude", "tmp"), { recursive: true });
  await writeFile(join(home, ".claude", "tmp", "parallelmax-counter.json"), JSON.stringify(data));
}

// Shorthand payloads.
function readPayload() {
  return { tool_name: "Read", tool_input: {} };
}
function writePayload(filePath: string) {
  return { tool_name: "Write", tool_input: { file_path: filePath } };
}
function agentPayload() {
  return { tool_name: "Agent", tool_input: {} };
}

describe("tool-cadence — parallelmax branch (e2e)", () => {
  // ── Test 1: The parallelmax branch counts silently — no nudge, no block ─────
  test("streak past the threshold emits nothing; Agent call resets the streak", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-pm-"));
    try {
      for (let i = 0; i < 8; i++) {
        const r = await runHook(i % 2 === 0 ? readPayload() : writePayload(`/tmp/f${i}.ts`), home);
        expect(r.exit).toBe(0);
        expect(r.stdout.trim()).toBe("");
      }
      expect((await readCounterState(home))?.count).toBe(8);

      const rAgent = await runHook(agentPayload(), home);
      expect(rAgent.exit).toBe(0);
      expect(rAgent.stdout.trim()).toBe("");
      const reset = await readCounterState(home);
      expect(reset?.count).toBe(0);
      expect(reset?.files).toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  // ── Test 5a: Completely missing state file handled without crashing ────────
  test("missing state file (null) handled without crashing", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-pm-"));
    try {
      // No state file written — readState returns null, normalizeCounterState defaults all fields.
      const r = await runHook(readPayload(), home, "12");
      expect(r.exit).toBe(0);
      const state = await readCounterState(home);
      expect(state?.count).toBe(1);
      expect(state?.nudged).toBe(false);
      expect(state?.escalated).toBe(false);
      expect(Array.isArray(state?.files)).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  // ── Test 5: Old-shape state file handled without crashing ─────────────────
  test("old-shape state file (no new fields) handled without crashing", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-pm-"));
    try {
      // Write an old-shape state file (pre-refactor shape).
      await writeCounterState(home, { count: 5, lastTool: "Read" });

      // Should not crash; should proceed normally (count=6, no nudge yet with threshold=12).
      const r = await runHook(readPayload(), home, "12");
      expect(r.exit).toBe(0);

      const state = await readCounterState(home);
      // Count incremented from 5 to 6.
      expect(state?.count).toBe(6);
      // New fields defaulted to their zero values.
      expect(state?.nudged).toBe(false);
      expect(state?.escalated).toBe(false);
      expect(Array.isArray(state?.files)).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
