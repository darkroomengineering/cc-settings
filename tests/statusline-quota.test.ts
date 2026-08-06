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
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(import.meta.dir, "../src/hooks/statusline.ts");

type Payload = Record<string, unknown>;

function payload(
  usedPercentage: number,
  resetsAt: number | string,
  sessionId = "session-a",
): Payload {
  return {
    session_id: sessionId,
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

/** Seeds a throwaway HOME's codex-verdict.json cache before the statusline hook
 *  runs, so the ⚡ chip's "→codex" routing badge can be exercised without a real
 *  Codex CLI on PATH. Mirrors the shape written by src/lib/codex.ts's writeCodexVerdict. */
async function seedCodexVerdict(home: string, state: string): Promise<void> {
  const tmpDir = join(home, ".claude", "tmp");
  await mkdir(tmpDir, { recursive: true });
  await writeFile(
    join(tmpDir, "codex-verdict.json"),
    JSON.stringify({ state, checkedAt: new Date().toISOString(), sticky: false }),
  );
}

async function runStatuslineWithSeededHome(
  input: Payload,
  seed: (home: string) => Promise<void>,
  env: Record<string, string | undefined> = {},
): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "cc-statusline-"));
  await seed(home);
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
  await rm(home, { recursive: true, force: true });
  return out;
}

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

describe("statusline rate-limit chip — exhausted routing badge", () => {
  test("exhausted (>=95%) + codex available → →codex suffix appears", async () => {
    const out = await runStatuslineWithSeededHome(
      payload(97, inTwoHours()),
      (home) => seedCodexVerdict(home, "available"),
      OUTSIDE,
    );
    expect(out).toContain("⚡97%");
    expect(out).toContain("→codex");
  });

  test("exhausted (>=95%) + codex NOT available → no →codex suffix", async () => {
    const out = await runStatuslineWithSeededHome(
      payload(97, inTwoHours()),
      (home) => seedCodexVerdict(home, "unauthenticated"),
      OUTSIDE,
    );
    expect(out).toContain("⚡97%");
    expect(out).not.toContain("→codex");
  });

  test("below exhausted threshold (94%) + codex available → no →codex suffix", async () => {
    const out = await runStatuslineWithSeededHome(
      payload(94, inTwoHours()),
      (home) => seedCodexVerdict(home, "available"),
      OUTSIDE,
    );
    expect(out).toContain("⚡94%");
    expect(out).not.toContain("→codex");
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
      // Flat top-level fields stay present — Programa's ClaudeQuotaSnapshotParser
      // (programa repo, Sources/ClaudeQuotaMonitor.swift) reads exactly these
      // three keys and must keep working unchanged.
      expect(cache.five_hour.used_percentage).toBe(62);
      expect(typeof cache.updated_at).toBe("number");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("statusline rate-limits cache — per-session map (multi-workspace fix)", () => {
  test("writes this session's reading under sessions[session_id]", async () => {
    const { home } = await runStatusline(payload(62, inTwoHours(), "session-a"));
    try {
      const raw = await readFile(join(home, ".claude", "tmp", "rate-limits.json"), "utf8");
      const cache = JSON.parse(raw);
      expect(cache.sessions["session-a"].five_hour.used_percentage).toBe(62);
      expect(typeof cache.sessions["session-a"].updated_at).toBe("number");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("a second session's render does not clobber the first session's entry", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-statusline-"));
    const cachePath = join(home, ".claude", "tmp", "rate-limits.json");
    const childEnv = (extra: Record<string, string | undefined>): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries({
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        ...extra,
      })) {
        if (v !== undefined) out[k] = v;
      }
      return out;
    };
    const runOnce = async (input: Payload): Promise<void> => {
      const proc = Bun.spawn(["bun", HOOK], {
        env: childEnv({}),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write(JSON.stringify(input));
      proc.stdin.end();
      await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);
    };

    try {
      // Workspace A renders first with a low reading, workspace B renders
      // second with a HIGHER reading. Pre-fix, the flat overwrite would drop
      // workspace A's entry entirely and workspace B's render would be the
      // only surviving data. Post-fix, both survive in `sessions`, and the
      // derived top-level max reflects the higher (true) usage.
      await runOnce(payload(8, inTwoHours(), "workspace-a"));
      await runOnce(payload(67, inTwoHours(), "workspace-b"));

      const cache = JSON.parse(await readFile(cachePath, "utf8"));
      expect(cache.sessions["workspace-a"].five_hour.used_percentage).toBe(8);
      expect(cache.sessions["workspace-b"].five_hour.used_percentage).toBe(67);
      // Derived top-level (Programa-compatible) reflects the MAX of fresh
      // sessions, not "whoever rendered last".
      expect(cache.five_hour.used_percentage).toBe(67);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("no session_id in payload → cache write skipped, no crash", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-statusline-"));
    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...process.env, HOME: home, USERPROFILE: home })) {
      if (v !== undefined) childEnv[k] = v;
    }
    const proc = Bun.spawn(["bun", HOOK], {
      env: childEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write(
      JSON.stringify({
        model: { display_name: "Opus 5" },
        workspace: { current_dir: "/tmp" },
        rate_limits: { five_hour: { used_percentage: 62, resets_at: inTwoHours() } },
      }),
    );
    proc.stdin.end();
    const out = await new Response(proc.stdout).text();
    try {
      expect(await proc.exited).toBe(0);
      expect(out).toContain("Opus 5");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
