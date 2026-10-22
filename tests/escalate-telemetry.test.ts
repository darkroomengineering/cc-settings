// Tests for the model-escalation advisory's fired-vs-acted telemetry:
// escalate-model.ts's recordFired (the "fired" moment), the new
// src/hooks/escalate-acted.ts (the "acted" detector), and the pure
// aggregation in src/lib/escalate-telemetry.ts / src/scripts/escalate-stats.ts.
// Sandboxed-HOME spawn pattern matches tests/escalate-model.test.ts and
// tests/session-model.test.ts.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { computeStats, parseTelemetryLine } from "../src/lib/escalate-telemetry.ts";

const ESCALATE_MODEL = resolve(import.meta.dir, "..", "src", "hooks", "escalate-model.ts");
const ESCALATE_ACTED = resolve(import.meta.dir, "..", "src", "hooks", "escalate-acted.ts");
const ESCALATE_STATS = resolve(import.meta.dir, "..", "src", "scripts", "escalate-stats.ts");
const DELEGATION_DETECTOR = resolve(
  import.meta.dir,
  "..",
  "src",
  "hooks",
  "delegation-detector.ts",
);
const SESSION_ID = "sess-telemetry-1";

interface SignatureMapFixture {
  [key: string]: { count: number; tool: string; sample: string };
}

async function writeSignatures(
  home: string,
  sessionId: string,
  map: SignatureMapFixture,
): Promise<void> {
  const dir = join(home, ".claude", "tmp");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `problem-signatures-${sessionId}`), JSON.stringify(map));
}

async function runEscalateModel(
  home: string,
  opts: { sessionId?: string; threshold?: string } = {},
): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", ESCALATE_MODEL], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CC_ESCALATE_THRESHOLD: opts.threshold ?? "3",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.write(
    JSON.stringify({ prompt: "still broken", session_id: opts.sessionId ?? SESSION_ID }),
  );
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

async function runEscalateActed(
  home: string,
  opts: { sessionId?: string; toolName?: string; toolInput?: Record<string, unknown> } = {},
): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", ESCALATE_ACTED], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.write(
    JSON.stringify({
      tool_name: opts.toolName ?? "Agent",
      tool_input: opts.toolInput ?? { subagent_type: "implementer" },
      session_id: opts.sessionId ?? SESSION_ID,
    }),
  );
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

async function runEscalateStats(
  home: string,
  args: string[] = [],
): Promise<{ stdout: string; stderr: string; exit: number }> {
  const proc = Bun.spawn(["bun", ESCALATE_STATS, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { stdout, stderr, exit };
}

async function readTelemetryLog(home: string): Promise<string[]> {
  try {
    const text = await readFile(join(home, ".claude", "logs", "escalate-telemetry.jsonl"), "utf8");
    return text.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function readPendingMarker(home: string, sessionId: string): Promise<unknown> {
  try {
    return JSON.parse(
      await readFile(join(home, ".claude", "tmp", `escalate-pending-${sessionId}`), "utf8"),
    );
  } catch {
    return null;
  }
}

async function runDelegationDetector(
  home: string,
  opts: { sessionId?: string; prompt?: string } = {},
): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", DELEGATION_DETECTOR], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.write(
    JSON.stringify({
      prompt: opts.prompt ?? "do all the things now",
      session_id: opts.sessionId ?? SESSION_ID,
    }),
  );
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

async function readDelegationPendingMarker(home: string, sessionId: string): Promise<unknown> {
  try {
    return JSON.parse(
      await readFile(join(home, ".claude", "tmp", `delegation-pending-${sessionId}`), "utf8"),
    );
  } catch {
    return null;
  }
}

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "cc-escalate-telemetry-"));
  try {
    await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

describe("escalate-model.ts — fired telemetry", () => {
  test("emitting the advisory writes a well-formed fired line + pending marker", async () => {
    await withHome(async (home) => {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      const { stdout } = await runEscalateModel(home);
      expect(stdout).toContain("hookSpecificOutput");

      const lines = await readTelemetryLog(home);
      expect(lines.length).toBe(1);
      const event = JSON.parse(lines[0] as string);
      expect(event.kind).toBe("fired");
      expect(event.session).toBe(SESSION_ID);
      expect(event.sig).toBe("abc123");
      expect(event.tool).toBe("Bash");
      expect(event.count).toBe(3);
      expect(event.variant).toBe("escalate");
      expect(typeof event.t).toBe("string");

      const marker = (await readPendingMarker(home, SESSION_ID)) as {
        sig: string;
        firedAt: number;
      } | null;
      expect(marker?.sig).toBe("abc123");
      expect(typeof marker?.firedAt).toBe("number");
    });
  });

  test("privacy: the fired line never contains the sample text, even a sentinel", async () => {
    await withHome(async (home) => {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "leaked SECRET_SENTINEL value here" },
      });
      await runEscalateModel(home);
      const lines = await readTelemetryLog(home);
      expect(lines.length).toBe(1);
      expect(lines[0]).not.toContain("SECRET_SENTINEL");
    });
  });

  test("Fable session → fired line records variant fable-session", async () => {
    await withHome(async (home) => {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      const dir = join(home, ".claude", "tmp");
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "session-models.json"),
        JSON.stringify({ [SESSION_ID]: { m: "Fable 5", t: Date.now() } }),
      );
      await runEscalateModel(home);
      const lines = await readTelemetryLog(home);
      const event = JSON.parse(lines[0] as string);
      expect(event.variant).toBe("fable-session");
    });
  });
});

describe("escalate-acted.ts", () => {
  test("no pending marker → writes nothing", async () => {
    await withHome(async (home) => {
      const { exit } = await runEscalateActed(home);
      expect(exit).toBe(0);
      const lines = await readTelemetryLog(home);
      expect(lines.length).toBe(0);
    });
  });

  test("Agent call within window → records acted, clears marker, second call records nothing", async () => {
    await withHome(async (home) => {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      await runEscalateModel(home);

      const { exit } = await runEscalateActed(home, {
        toolInput: { subagent_type: "implementer", model: "fable" },
      });
      expect(exit).toBe(0);

      const lines = await readTelemetryLog(home);
      expect(lines.length).toBe(2); // one fired + one acted
      // biome-ignore lint/suspicious/noExplicitAny: test-only JSONL parsing
      const events = lines.map((l) => JSON.parse(l) as any);
      const acted = events.find((e) => e.kind === "acted");
      expect(acted).toBeDefined();
      expect(acted.sig).toBe("abc123");
      expect(acted.model).toBe("fable");
      expect(typeof acted.latencyMs).toBe("number");
      expect(acted.latencyMs).toBeGreaterThanOrEqual(0);
      expect(acted.latencyMs).toBeLessThan(60_000); // plausible for a same-test round trip

      const marker = await readPendingMarker(home, SESSION_ID);
      expect(marker).toEqual({});

      // Second Agent call — marker already cleared, nothing new recorded.
      await runEscalateActed(home);
      const linesAfter = await readTelemetryLog(home);
      expect(linesAfter.length).toBe(2);
    });
  });

  test("no model override in tool_input → acted line records model: null", async () => {
    await withHome(async (home) => {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      await runEscalateModel(home);
      await runEscalateActed(home, { toolInput: { subagent_type: "implementer" } });
      const lines = await readTelemetryLog(home);
      // biome-ignore lint/suspicious/noExplicitAny: test-only JSONL parsing
      const events = lines.map((l) => JSON.parse(l) as any);
      const acted = events.find((e) => e.kind === "acted");
      expect(acted.model).toBeNull();
    });
  });

  test("stale marker (past the 60-minute window) → no acted line, marker cleared", async () => {
    await withHome(async (home) => {
      const dir = join(home, ".claude", "tmp");
      await mkdir(dir, { recursive: true });
      const staleFiredAt = Date.now() - 61 * 60_000;
      await writeFile(
        join(dir, `escalate-pending-${SESSION_ID}`),
        JSON.stringify({ sig: "abc123", firedAt: staleFiredAt }),
      );
      await runEscalateActed(home);
      const lines = await readTelemetryLog(home);
      expect(lines.length).toBe(0);
      const marker = await readPendingMarker(home, SESSION_ID);
      expect(marker).toEqual({});
    });
  });

  test("non-Agent tool call → no-op even with a pending marker", async () => {
    await withHome(async (home) => {
      const dir = join(home, ".claude", "tmp");
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, `escalate-pending-${SESSION_ID}`),
        JSON.stringify({ sig: "abc123", firedAt: Date.now() }),
      );
      await runEscalateActed(home, { toolName: "Bash", toolInput: { command: "ls" } });
      const lines = await readTelemetryLog(home);
      expect(lines.length).toBe(0);
      // Never observed — the Agent check short-circuits before the marker is
      // even read, so it must survive untouched.
      const marker = (await readPendingMarker(home, SESSION_ID)) as {
        sig: string;
        firedAt: number;
      };
      expect(marker.sig).toBe("abc123");
    });
  });

  test("overwrite semantics: two fires then one Agent call → acted pairs with the SECOND sig", async () => {
    await withHome(async (home) => {
      const dir = join(home, ".claude", "tmp");
      await mkdir(dir, { recursive: true });

      await writeSignatures(home, SESSION_ID, {
        first111: { count: 3, tool: "Bash", sample: "first error" },
      });
      await runEscalateModel(home);

      const markerAfterFirstFire = (await readPendingMarker(home, SESSION_ID)) as {
        sig: string;
      };
      expect(markerAfterFirstFire.sig).toBe("first111");

      // Bypass escalate.ts's global 10-minute debounce so a second, genuinely
      // distinct signature can fire again in the same session.
      const stateFile = join(dir, "escalate-model-state.json");
      const state = JSON.parse(await readFile(stateFile, "utf8"));
      state.lastEmit = Date.now() - 20 * 60_000;
      await writeFile(stateFile, JSON.stringify(state));

      await writeSignatures(home, SESSION_ID, {
        second222: { count: 3, tool: "Edit", sample: "second error" },
      });
      await runEscalateModel(home);

      const markerAfterSecondFire = (await readPendingMarker(home, SESSION_ID)) as {
        sig: string;
      };
      expect(markerAfterSecondFire.sig).toBe("second222");

      await runEscalateActed(home);
      const lines = await readTelemetryLog(home);
      // biome-ignore lint/suspicious/noExplicitAny: test-only JSONL parsing
      const events = lines.map((l) => JSON.parse(l) as any);
      const acted = events.find((e) => e.kind === "acted");
      expect(acted.sig).toBe("second222");
      expect(acted.sig).not.toBe("first111");
    });
  });
});

describe("escalate-stats.ts", () => {
  test('missing log → "no telemetry yet", exit 0', async () => {
    await withHome(async (home) => {
      const { stdout, exit } = await runEscalateStats(home);
      expect(exit).toBe(0);
      expect(stdout.toLowerCase()).toContain("no telemetry yet");
    });
  });

  test("fixture log (3 fired, 1 acted, one malformed line) → correct totals, doesn't crash", async () => {
    await withHome(async (home) => {
      const dir = join(home, ".claude", "logs");
      await mkdir(dir, { recursive: true });
      const lines = [
        JSON.stringify({
          t: "2026-01-01T00:00:00Z",
          session: "s1",
          kind: "fired",
          sig: "a",
          tool: "Bash",
          count: 3,
          variant: "escalate",
        }),
        JSON.stringify({
          t: "2026-01-01T00:01:00Z",
          session: "s2",
          kind: "fired",
          sig: "b",
          tool: "Edit",
          count: 4,
          variant: "escalate",
        }),
        JSON.stringify({
          t: "2026-01-01T00:02:00Z",
          session: "s3",
          kind: "fired",
          sig: "c",
          tool: "Bash",
          count: 5,
          variant: "fable-session",
        }),
        JSON.stringify({
          t: "2026-01-01T00:03:00Z",
          session: "s1",
          kind: "acted",
          sig: "a",
          latencyMs: 5000,
          model: "fable",
        }),
        "not json at all",
      ];
      await writeFile(join(dir, "escalate-telemetry.jsonl"), `${lines.join("\n")}\n`);

      const { stdout, exit } = await runEscalateStats(home);
      expect(exit).toBe(0);
      expect(stdout).toContain("Fired: 3");
      expect(stdout).toContain("Acted: 1");
      expect(stdout).toContain("33.3%");
      expect(stdout).toContain("fable: 1");
      expect(stdout).toContain("all time");
    });
  });

  test("--days 7 excludes lines older than the window and labels the header; absent flag is lifetime", async () => {
    await withHome(async (home) => {
      const dir = join(home, ".claude", "logs");
      await mkdir(dir, { recursive: true });
      const now = Date.now();
      const recent = new Date(now - 1 * 24 * 60 * 60_000).toISOString(); // 1 day ago
      const old = new Date(now - 30 * 24 * 60 * 60_000).toISOString(); // 30 days ago
      const lines = [
        JSON.stringify({
          t: recent,
          session: "s1",
          kind: "fired",
          sig: "a",
          tool: "Bash",
          count: 3,
          variant: "escalate",
        }),
        JSON.stringify({
          t: old,
          session: "s2",
          kind: "fired",
          sig: "b",
          tool: "Edit",
          count: 4,
          variant: "escalate",
        }),
      ];
      await writeFile(join(dir, "escalate-telemetry.jsonl"), `${lines.join("\n")}\n`);

      const windowed = await runEscalateStats(home, ["--days", "7"]);
      expect(windowed.exit).toBe(0);
      expect(windowed.stdout).toContain("last 7 days");
      expect(windowed.stdout).toContain("Fired: 1");

      const lifetime = await runEscalateStats(home);
      expect(lifetime.exit).toBe(0);
      expect(lifetime.stdout).toContain("all time");
      expect(lifetime.stdout).toContain("Fired: 2");
    });
  });

  test("--days 0 and --days abc are rejected with usage + exit 1", async () => {
    await withHome(async (home) => {
      const zero = await runEscalateStats(home, ["--days", "0"]);
      expect(zero.exit).toBe(1);
      expect(zero.stderr.toLowerCase()).toContain("usage");

      const nonNumeric = await runEscalateStats(home, ["--days", "abc"]);
      expect(nonNumeric.exit).toBe(1);
      expect(nonNumeric.stderr.toLowerCase()).toContain("usage");
    });
  });

  test("unreadable log (EISDIR) → stderr + exit 1, distinct from the missing-file case", async () => {
    await withHome(async (home) => {
      const dir = join(home, ".claude", "logs");
      // Point the log path at a directory instead of a file to force a
      // non-ENOENT read error.
      await mkdir(join(dir, "escalate-telemetry.jsonl"), { recursive: true });

      const { stdout, stderr, exit } = await runEscalateStats(home);
      expect(exit).toBe(1);
      expect(stdout).toBe("");
      expect(stderr.length).toBeGreaterThan(0);
    });
  });
});

describe("escalate-telemetry.ts — pure helpers", () => {
  test("parseTelemetryLine rejects malformed JSON and unrecognized shapes", () => {
    expect(parseTelemetryLine("not json")).toBeNull();
    expect(parseTelemetryLine(JSON.stringify({ kind: "other" }))).toBeNull();
    expect(parseTelemetryLine(JSON.stringify({ kind: "fired" }))).toBeNull();
  });

  test("parseTelemetryLine accepts well-formed fired and acted lines", () => {
    const fired = parseTelemetryLine(
      JSON.stringify({
        t: "2026-01-01T00:00:00Z",
        session: "s1",
        kind: "fired",
        sig: "a",
        tool: "Bash",
        count: 3,
        variant: "escalate",
      }),
    );
    expect(fired?.kind).toBe("fired");
    const acted = parseTelemetryLine(
      JSON.stringify({
        t: "2026-01-01T00:00:00Z",
        session: "s1",
        kind: "acted",
        sig: "a",
        latencyMs: 100,
        model: null,
      }),
    );
    expect(acted?.kind).toBe("acted");
  });

  test("computeStats computes act-rate and per-model/per-variant breakdowns", () => {
    const stats = computeStats([
      {
        t: "t",
        session: "s1",
        kind: "fired",
        sig: "a",
        tool: "Bash",
        count: 3,
        variant: "escalate",
      },
      {
        t: "t",
        session: "s2",
        kind: "fired",
        sig: "b",
        tool: "Edit",
        count: 4,
        variant: "fable-session",
      },
      { t: "t", session: "s1", kind: "acted", sig: "a", latencyMs: 1000, model: "fable" },
    ]);
    expect(stats.firedTotal).toBe(2);
    expect(stats.actedTotal).toBe(1);
    expect(stats.actRate).toBe(50);
    expect(stats.medianActedLatencyMs).toBe(1000);
    expect(stats.byVariant.escalate).toBe(1);
    expect(stats.byVariant["fable-session"]).toBe(1);
    expect(stats.byModel.fable).toBe(1);
  });

  test("computeStats with zero fired events returns a 0% act-rate, not NaN or a crash", () => {
    const stats = computeStats([]);
    expect(stats.firedTotal).toBe(0);
    expect(stats.actedTotal).toBe(0);
    expect(stats.actRate).toBe(0);
    expect(stats.medianActedLatencyMs).toBeNull();
  });

  test("honesty guarantee: two acted lines with the same (session, sig) count once", () => {
    const stats = computeStats([
      {
        t: "2026-01-01T00:00:00Z",
        session: "s1",
        kind: "fired",
        sig: "a",
        tool: "Bash",
        count: 3,
        variant: "escalate",
      },
      {
        t: "2026-01-01T00:01:00Z",
        session: "s1",
        kind: "acted",
        sig: "a",
        latencyMs: 1000,
        model: "fable",
      },
      // Double-consume race: a second Agent call observed the same marker
      // before it was cleared and wrote its own acted line for the same
      // (session, sig).
      {
        t: "2026-01-01T00:01:05Z",
        session: "s1",
        kind: "acted",
        sig: "a",
        latencyMs: 1500,
        model: "sonnet",
      },
    ]);
    expect(stats.firedTotal).toBe(1);
    expect(stats.actedTotal).toBe(1);
    expect(stats.actRate).toBe(100);
    // Earliest occurrence wins.
    expect(stats.medianActedLatencyMs).toBe(1000);
    expect(stats.byModel.fable).toBe(1);
    expect(stats.byModel.sonnet).toBeUndefined();
  });

  test("honesty guarantee: an acted line with no matching fired is not counted, act-rate stays <= 100%", () => {
    const stats = computeStats([
      {
        t: "2026-01-01T00:00:00Z",
        session: "s1",
        kind: "fired",
        sig: "a",
        tool: "Bash",
        count: 3,
        variant: "escalate",
      },
      // Write-ordering skew: the fired append failed but the marker write
      // landed, so this acted line has no matching fired for its (session, sig).
      {
        t: "2026-01-01T00:01:00Z",
        session: "s2",
        kind: "acted",
        sig: "orphan",
        latencyMs: 1000,
        model: "fable",
      },
    ]);
    expect(stats.firedTotal).toBe(1);
    expect(stats.actedTotal).toBe(0);
    expect(stats.actRate).toBe(0);
    expect(stats.actRate).toBeLessThanOrEqual(100);
  });

  test("lines with no advisory field are counted as escalate; delegation stats are separate", () => {
    const stats = computeStats([
      // old-format escalate lines — no `advisory` field at all, exactly what
      // every escalate line on disk (before and after this change) looks like.
      {
        t: "2026-01-01T00:00:00Z",
        session: "s1",
        kind: "fired",
        sig: "a",
        tool: "Bash",
        count: 3,
        variant: "escalate",
      },
      {
        t: "2026-01-01T00:01:00Z",
        session: "s1",
        kind: "acted",
        sig: "a",
        latencyMs: 1000,
        model: "fable",
      },
      // delegation fired/acted, explicit advisory field.
      {
        t: "2026-01-01T00:02:00Z",
        session: "s2",
        kind: "fired",
        advisory: "delegation",
        at: 5000,
        score: 2,
      },
      {
        t: "2026-01-01T00:03:00Z",
        session: "s2",
        kind: "acted",
        advisory: "delegation",
        at: 5000,
        latencyMs: 500,
      },
    ]);

    expect(stats.firedTotal).toBe(1);
    expect(stats.actedTotal).toBe(1);
    expect(stats.actRate).toBe(100);
    expect(stats.delegation.firedTotal).toBe(1);
    expect(stats.delegation.actedTotal).toBe(1);
    expect(stats.delegation.actRate).toBe(100);
    expect(stats.delegation.medianActedLatencyMs).toBe(500);
  });

  test("delegation dedupe: duplicate acted (session, at) counted once; orphan acted not counted", () => {
    const stats = computeStats([
      {
        t: "2026-01-01T00:00:00Z",
        session: "s1",
        kind: "fired",
        advisory: "delegation",
        at: 1000,
        score: 2,
      },
      {
        t: "2026-01-01T00:01:00Z",
        session: "s1",
        kind: "acted",
        advisory: "delegation",
        at: 1000,
        latencyMs: 100,
      },
      // Double-consume race: a second Agent call observed the same marker
      // before it was cleared and wrote its own acted line for (s1, 1000).
      {
        t: "2026-01-01T00:01:05Z",
        session: "s1",
        kind: "acted",
        advisory: "delegation",
        at: 1000,
        latencyMs: 200,
      },
      // Orphan: no fired line exists for (s2, 9999).
      {
        t: "2026-01-01T00:02:00Z",
        session: "s2",
        kind: "acted",
        advisory: "delegation",
        at: 9999,
        latencyMs: 50,
      },
    ]);

    expect(stats.delegation.firedTotal).toBe(1);
    expect(stats.delegation.actedTotal).toBe(1);
    expect(stats.delegation.actRate).toBe(100);
    expect(stats.delegation.medianActedLatencyMs).toBe(100); // earliest wins
  });
});

describe("delegation-detector.ts — fired telemetry", () => {
  test("emitting the advisory writes a well-formed fired line + pending marker", async () => {
    await withHome(async (home) => {
      const { stdout } = await runDelegationDetector(home, { prompt: "do all the things now" });
      expect(stdout).toContain("hookSpecificOutput");

      const lines = await readTelemetryLog(home);
      expect(lines.length).toBe(1);
      const event = JSON.parse(lines[0] as string);
      expect(event.kind).toBe("fired");
      expect(event.advisory).toBe("delegation");
      expect(event.session).toBe(SESSION_ID);
      expect(typeof event.at).toBe("number");
      expect(typeof event.score).toBe("number");
      expect(event.score).toBeGreaterThanOrEqual(2);
      expect(typeof event.t).toBe("string");

      const marker = (await readDelegationPendingMarker(home, SESSION_ID)) as {
        at: number;
        firedAt: number;
      } | null;
      expect(typeof marker?.at).toBe("number");
      expect(marker?.at).toBe(marker?.firedAt);
    });
  });

  test("privacy: the fired line never contains the matched phrase or prompt text", async () => {
    await withHome(async (home) => {
      await runDelegationDetector(home, { prompt: "do all the SECRET_SENTINEL things now" });
      const lines = await readTelemetryLog(home);
      expect(lines.length).toBe(1);
      expect(lines[0]).not.toContain("SECRET_SENTINEL");
      expect(lines[0]).not.toContain("do all");
    });
  });

  test("score below threshold → no fired line, no marker", async () => {
    await withHome(async (home) => {
      await runDelegationDetector(home, { prompt: "hello there" });
      const lines = await readTelemetryLog(home);
      expect(lines.length).toBe(0);
      const marker = await readDelegationPendingMarker(home, SESSION_ID);
      expect(marker).toBeNull();
    });
  });
});

describe("escalate-acted.ts — delegation pairing", () => {
  test("Agent call within the 10-minute window → delegation acted, marker cleared", async () => {
    await withHome(async (home) => {
      await runDelegationDetector(home, { prompt: "do all the things now" });
      const { exit } = await runEscalateActed(home);
      expect(exit).toBe(0);

      const lines = await readTelemetryLog(home);
      expect(lines.length).toBe(2); // one fired + one acted
      // biome-ignore lint/suspicious/noExplicitAny: test-only JSONL parsing
      const events = lines.map((l) => JSON.parse(l) as any);
      const acted = events.find((e) => e.kind === "acted" && e.advisory === "delegation");
      expect(acted).toBeDefined();
      expect(typeof acted.at).toBe("number");
      expect(typeof acted.latencyMs).toBe("number");
      expect(acted.latencyMs).toBeGreaterThanOrEqual(0);

      const marker = await readDelegationPendingMarker(home, SESSION_ID);
      expect(marker).toEqual({});
    });
  });

  test("stale delegation marker (past the 10-minute window) → no acted line, marker cleared", async () => {
    await withHome(async (home) => {
      const dir = join(home, ".claude", "tmp");
      await mkdir(dir, { recursive: true });
      const staleAt = Date.now() - 11 * 60_000;
      await writeFile(
        join(dir, `delegation-pending-${SESSION_ID}`),
        JSON.stringify({ at: staleAt, firedAt: staleAt }),
      );
      await runEscalateActed(home);
      const lines = await readTelemetryLog(home);
      expect(lines.length).toBe(0);
      const marker = await readDelegationPendingMarker(home, SESSION_ID);
      expect(marker).toEqual({});
    });
  });

  test("both escalate and delegation pending, one Agent call → two acted lines, one per advisory", async () => {
    await withHome(async (home) => {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      await runEscalateModel(home);
      await runDelegationDetector(home, { prompt: "do all the things now" });

      await runEscalateActed(home);
      const lines = await readTelemetryLog(home);
      expect(lines.length).toBe(4); // 2 fired + 2 acted
      // biome-ignore lint/suspicious/noExplicitAny: test-only JSONL parsing
      const events = lines.map((l) => JSON.parse(l) as any);
      const actedEvents = events.filter((e) => e.kind === "acted");
      expect(actedEvents.length).toBe(2);
      const advisories = actedEvents.map((e) => e.advisory ?? "escalate").sort();
      expect(advisories).toEqual(["delegation", "escalate"]);
    });
  });
});
