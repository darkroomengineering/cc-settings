// Parallelmax branch e2e tests for tool-cadence.ts.
// Uses the same sandboxed-HOME pattern as review-queue.test.ts.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "tool-cadence.ts");

async function runHook(
  payload: unknown,
  home: string,
  threshold = "3",
): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", HOOK], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CC_PARALLELMAX_THRESHOLD: threshold,
      // Suppress review-queue nudges during these tests.
      CC_MAX_UNREVIEWED: "100",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
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
  // ── Test 1: Nudge fires once at the count threshold ─────────────────────
  test("nudge fires once at the count threshold; no second nudge in the same streak", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-pm-"));
    try {
      // Three Read calls with threshold=3 should trigger the nudge on the 3rd.
      const r1 = await runHook(readPayload(), home);
      const r2 = await runHook(readPayload(), home);
      expect(r1.stdout).not.toContain("Delegation check");
      expect(r2.stdout).not.toContain("Delegation check");

      const r3 = await runHook(readPayload(), home);
      expect(r3.stdout).toContain("Delegation check");
      expect(r3.exit).toBe(0);

      // State should be nudged=true now.
      const state = await readCounterState(home);
      expect(state?.nudged).toBe(true);

      // Push firedAt into the past so debounce doesn't suppress escalation,
      // but we want to verify no second "Delegation check" fires.
      await writeCounterState(home, {
        ...state,
        firedAt: Date.now() - 70_000,
      });

      // More calls — these should trigger escalation (count - countAtNudge >= THRESHOLD),
      // NOT a second nudge. Verify no second "Delegation check" appears.
      const r4 = await runHook(readPayload(), home);
      const r5 = await runHook(readPayload(), home);
      const r6 = await runHook(readPayload(), home);
      // At least one of these might escalate, but none should have a second nudge.
      expect(r4.stdout).not.toContain("Delegation check");
      expect(r5.stdout).not.toContain("Delegation check");
      expect(r6.stdout).not.toContain("Delegation check");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  // ── Test 2: Escalation fires once after nudge; further calls are silent ──
  test("escalation fires once after nudge when count advances by THRESHOLD; then silent", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-pm-"));
    try {
      // Manually set state to: nudged=true, countAtNudge=3, count=3, debounce expired.
      await writeCounterState(home, {
        count: 3,
        lastTool: "Read",
        firedAt: Date.now() - 70_000,
        files: [],
        nudged: true,
        countAtNudge: 3,
        filesAtNudge: 0,
        escalated: false,
      });

      // Three more calls (threshold=3) should trigger escalation on the 3rd.
      const r1 = await runHook(readPayload(), home);
      const r2 = await runHook(readPayload(), home);
      expect(r1.stdout).not.toContain('"decision":"block"');
      expect(r2.stdout).not.toContain('"decision":"block"');

      const r3 = await runHook(readPayload(), home);
      expect(r3.stdout).toContain('"decision":"block"');
      expect(r3.stdout).toContain("Delegation violation");
      expect(r3.exit).toBe(2);

      // State should now have escalated=true.
      const state = await readCounterState(home);
      expect(state?.escalated).toBe(true);

      // Push firedAt into the past so debounce doesn't suppress future checks.
      await writeCounterState(home, {
        ...state,
        firedAt: Date.now() - 70_000,
      });

      // Further calls after escalation should be silent.
      const r4 = await runHook(readPayload(), home);
      const r5 = await runHook(readPayload(), home);
      expect(r4.stdout).toBe("");
      expect(r4.exit).toBe(0);
      expect(r5.stdout).toBe("");
      expect(r5.exit).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  // ── Test 3: 3 distinct Write file_paths trigger the nudge before call count ──
  test("3 distinct Write file_paths trigger nudge before count threshold", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-pm-"));
    try {
      // Use threshold=100 so call count won't trigger, only file count will.
      const r1 = await runHook(writePayload("src/a.ts"), home, "100");
      const r2 = await runHook(writePayload("src/b.ts"), home, "100");
      expect(r1.stdout).not.toContain("Delegation check");
      expect(r2.stdout).not.toContain("Delegation check");

      const r3 = await runHook(writePayload("src/c.ts"), home, "100");
      expect(r3.stdout).toContain("Delegation check");
      expect(r3.stdout).toContain("file(s) edited");
      expect(r3.exit).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  // ── Test 4: Agent call resets streak; fresh streak can nudge again ────────
  test("Agent call resets streak; calls below threshold after reset are silent", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-pm-"));
    try {
      // Build up a streak to the point of nudge.
      await runHook(readPayload(), home);
      await runHook(readPayload(), home);
      const r3 = await runHook(readPayload(), home);
      expect(r3.stdout).toContain("Delegation check");

      // Agent call resets streak.
      const rAgent = await runHook(agentPayload(), home);
      expect(rAgent.stdout).not.toContain("Delegation check");
      expect(rAgent.exit).toBe(0);

      const state = await readCounterState(home);
      expect(state?.count).toBe(0);
      expect(state?.nudged).toBe(false);
      expect(state?.escalated).toBe(false);

      // Push firedAt into the past so the debounce doesn't block fresh nudge.
      await writeCounterState(home, {
        ...state,
        firedAt: Date.now() - 70_000,
      });

      // Below threshold — silent.
      const r4 = await runHook(readPayload(), home);
      const r5 = await runHook(readPayload(), home);
      expect(r4.stdout).not.toContain("Delegation check");
      expect(r5.stdout).not.toContain("Delegation check");

      // Back to threshold — fresh nudge fires.
      const r6 = await runHook(readPayload(), home);
      expect(r6.stdout).toContain("Delegation check");
      expect(r6.exit).toBe(0);
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
