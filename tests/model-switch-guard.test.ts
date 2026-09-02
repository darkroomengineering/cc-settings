// Behavioral tests for the PreModelSwitch guard (src/hooks/model-switch-guard.ts).
// Spawned as a subprocess with a sandboxed HOME (same pattern as
// tests/statusline-quota.test.ts / hook-fail-open.test.ts) so the real
// ~/.claude/tmp/rate-limits.json is never touched by fixture numbers.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(import.meta.dir, "../src/hooks/model-switch-guard.ts");

const inTwoHours = (): number => Math.floor(Date.now() / 1000) + 8100; // +2h15m

/** Seeds a throwaway HOME's rate-limits.json with a single fresh session
 *  reading, shaped exactly as RateLimitsCacheSchema/resolveRateLimits expect
 *  (src/lib/quota.ts): `resets_at` in the future so the window isn't pruned as
 *  rolled-over, and `updated_at` recent so the session isn't pruned as stale. */
async function seedRateLimitsCache(home: string, sevenDayPct: number): Promise<void> {
  const tmpDir = join(home, ".claude", "tmp");
  await mkdir(tmpDir, { recursive: true });
  const now = Date.now();
  const resetsAt = inTwoHours();
  await writeFile(
    join(tmpDir, "rate-limits.json"),
    JSON.stringify({
      updated_at: now,
      sessions: {
        "session-a": {
          seven_day: { used_percentage: sevenDayPct, resets_at: resetsAt },
          updated_at: now,
        },
      },
    }),
  );
}

async function seedMalformedRateLimitsCache(home: string): Promise<void> {
  const tmpDir = join(home, ".claude", "tmp");
  await mkdir(tmpDir, { recursive: true });
  await writeFile(join(tmpDir, "rate-limits.json"), JSON.stringify({ sessions: "nope" }));
}

async function runHook(
  toModel: string,
  seed?: (home: string) => Promise<void>,
): Promise<{ code: number; out: string }> {
  const home = await mkdtemp(join(tmpdir(), "cc-model-switch-guard-"));
  try {
    if (seed) await seed(home);
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
    proc.stdin.write(JSON.stringify({ to_model: toModel, from_model: "claude-opus-5" }));
    proc.stdin.end();
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return { code, out };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

describe("model-switch-guard — PreModelSwitch", () => {
  test("fable target, 97% weekly (exhausted band) → ask, reason contains 97%", async () => {
    const { code, out } = await runHook("claude-fable-5-1", (home) =>
      seedRateLimitsCache(home, 97),
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.decision).toBe("ask");
    expect(parsed.hookSpecificOutput.reason).toContain("97%");
  });

  test("fable target, 88% weekly (critical band) → allow, additionalContext mentions critical", async () => {
    const { code, out } = await runHook("claude-fable-5-1", (home) =>
      seedRateLimitsCache(home, 88),
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.decision).toBe("allow");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("critical");
  });

  test("fable target, 30% weekly (normal band) → empty stdout", async () => {
    const { code, out } = await runHook("claude-fable-5-1", (home) =>
      seedRateLimitsCache(home, 30),
    );
    expect(code).toBe(0);
    expect(out.trim()).toBe("");
  });

  test("non-fable target (claude-opus-5), 97% weekly → empty stdout", async () => {
    const { code, out } = await runHook("claude-opus-5", (home) => seedRateLimitsCache(home, 97));
    expect(code).toBe(0);
    expect(out.trim()).toBe("");
  });

  test("no cache file → empty stdout, exit 0", async () => {
    const { code, out } = await runHook("claude-fable-5-1");
    expect(code).toBe(0);
    expect(out.trim()).toBe("");
  });

  test("malformed cache file → empty stdout, exit 0", async () => {
    const { code, out } = await runHook("claude-fable-5-1", seedMalformedRateLimitsCache);
    expect(code).toBe(0);
    expect(out.trim()).toBe("");
  });
});
