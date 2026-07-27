// Behavioral tests for the statusline's rate-limit chip (src/hooks/statusline.ts).
//
// Two things are under test and they pull in opposite directions:
//   1. The ⚡ chip is SUPPRESSED inside Programa (its sidebar already shows the
//      same 5h numbers) and RENDERED everywhere else, where it is the only
//      quota surface the user has.
//   2. The rate-limits CACHE WRITE is unconditional. Programa's sidebar and
//      quota-steer.ts both read that file, and statusline is what keeps it
//      fresh between sessions — gating the write along with the display would
//      leave the sidebar showing whatever the last session start captured.
//
// Spawned as a subprocess with a sandboxed HOME (same pattern as
// hook-fail-open.test.ts) so the real ~/.claude/tmp/rate-limits.json is never
// clobbered with fixture numbers.

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(import.meta.dir, "../src/hooks/statusline.ts");

type Payload = Record<string, unknown>;

function payload(usedPercentage: number, resetsAt: number | string): Payload {
  return {
    model: { display_name: "Opus 5" },
    workspace: { current_dir: "/tmp" },
    rate_limits: { five_hour: { used_percentage: usedPercentage, resets_at: resetsAt } },
  };
}

/** Run the statusline hook under a throwaway HOME; returns stdout + that HOME. */
async function runStatusline(
  input: Payload,
  env: Record<string, string | undefined> = {},
): Promise<{ out: string; home: string }> {
  const home = await mkdtemp(join(tmpdir(), "cc-statusline-"));
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, HOME: home, USERPROFILE: home, ...env })) {
    if (v !== undefined) childEnv[k] = v;
  }
  const proc = Bun.spawn(["bun", HOOK], {
    env: childEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(JSON.stringify(input));
  proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return { out, home };
}

/** Same, but cleans the sandbox HOME up when the assertions don't need it. */
async function statuslineOutput(
  input: Payload,
  env: Record<string, string | undefined> = {},
): Promise<string> {
  const { out, home } = await runStatusline(input, env);
  await rm(home, { recursive: true, force: true });
  return out;
}

const inTwoHours = (): number => Math.floor(Date.now() / 1000) + 8100; // +2h15m
const OUTSIDE = { PROGRAMA_SURFACE_ID: undefined };
const INSIDE = { PROGRAMA_SURFACE_ID: "95BBD408-7E22-46A3-9C53-7522F1C7D2E9" };

describe("statusline rate-limit chip — Programa gate", () => {
  test("outside Programa → chip renders with percentage", async () => {
    const out = await statuslineOutput(payload(62, inTwoHours()), OUTSIDE);
    expect(out).toContain("⚡");
    expect(out).toContain("62%");
  });

  test("inside Programa → chip suppressed", async () => {
    const out = await statuslineOutput(payload(62, inTwoHours()), INSIDE);
    expect(out).not.toContain("⚡");
    expect(out).not.toContain("62%");
    // The rest of the statusline still renders — the gate is chip-only.
    expect(out).toContain("Opus 5");
  });

  test("empty PROGRAMA_SURFACE_ID is not 'inside Programa'", async () => {
    const out = await statuslineOutput(payload(62, inTwoHours()), { PROGRAMA_SURFACE_ID: "" });
    expect(out).toContain("⚡");
  });

  test("no rate_limits in payload → no chip, still exits 0", async () => {
    const out = await statuslineOutput(
      { model: { display_name: "Opus 5" }, workspace: { current_dir: "/tmp" } },
      OUTSIDE,
    );
    expect(out).not.toContain("⚡");
    expect(out).toContain("Opus 5");
  });
});

describe("statusline time-to-reset — resets_at shape tolerance", () => {
  test("Unix epoch SECONDS → ↻ suffix (the current Claude Code payload shape)", async () => {
    const out = await statuslineOutput(payload(62, inTwoHours()), OUTSIDE);
    expect(out).toMatch(/↻\d+h\d{2}m/);
  });

  test("ISO string → ↻ suffix (older Claude Code builds)", async () => {
    const iso = new Date(inTwoHours() * 1000).toISOString();
    const out = await statuslineOutput(payload(62, iso), OUTSIDE);
    expect(out).toMatch(/↻\d+h\d{2}m/);
  });

  test("already-elapsed reset → chip renders without a ↻ suffix", async () => {
    const out = await statuslineOutput(payload(12, 1_000_000_000), OUTSIDE);
    expect(out).toContain("⚡");
    expect(out).not.toContain("↻");
  });

  test("unparseable resets_at → chip renders without a ↻ suffix", async () => {
    const out = await statuslineOutput(payload(12, "not-a-timestamp"), OUTSIDE);
    expect(out).toContain("⚡");
    expect(out).not.toContain("↻");
  });
});

describe("statusline rate-limits cache — written regardless of the gate", () => {
  test.each([
    ["outside Programa", OUTSIDE],
    ["inside Programa", INSIDE],
  ])("%s → rate-limits.json is still refreshed", async (_label, env) => {
    const { home } = await runStatusline(payload(62, inTwoHours()), env);
    try {
      const raw = await readFile(join(home, ".claude", "tmp", "rate-limits.json"), "utf8");
      const cache = JSON.parse(raw);
      expect(cache.five_hour.used_percentage).toBe(62);
      expect(typeof cache.updated_at).toBe("number");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
