// Behavioral tests for the statusline's prompt-cache hit-ratio segment
// (src/hooks/statusline.ts, `prompt_cache` payload — Claude Code 2.1.251).
//
// The ♻ segment is display-only: no reads or writes of ~/.claude/tmp are
// involved, unlike the ⚡ rate-limits chip. Spawned as a subprocess with a
// sandboxed HOME anyway, matching statusline-quota.test.ts's pattern, so a
// crash mid-render can't leak into the real ~/.claude/tmp.

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(import.meta.dir, "../src/hooks/statusline.ts");

type Payload = Record<string, unknown>;

function payload(promptCache?: Record<string, unknown>): Payload {
  const base: Payload = {
    model: { display_name: "Fable 5.1" },
    workspace: { current_dir: "/tmp" },
  };
  if (promptCache) base.prompt_cache = promptCache;
  return base;
}

async function statuslineOutput(input: Payload): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "cc-statusline-cache-"));
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
  proc.stdin.write(JSON.stringify(input));
  proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  await rm(home, { recursive: true, force: true });
  return out;
}

describe("statusline prompt-cache segment", () => {
  test("warm cache, high hit ratio → ♻91% without 'cold'", async () => {
    const out = await statuslineOutput(
      payload({ warm: true, caching_observed: true, requests: 14, hit_ratio: 0.91 }),
    );
    expect(out).toContain("♻91%");
    expect(out).not.toContain("cold");
  });

  test("cold cache → ♻91% cold", async () => {
    const out = await statuslineOutput(
      payload({ warm: false, caching_observed: true, requests: 14, hit_ratio: 0.91 }),
    );
    expect(out).toContain("♻91%");
    expect(out).toContain("cold");
  });

  test("caching_observed: false → no ♻ segment", async () => {
    const out = await statuslineOutput(
      payload({ warm: true, caching_observed: false, requests: 14, hit_ratio: 0.91 }),
    );
    expect(out).not.toContain("♻");
  });

  test("hit_ratio: null → no ♻ segment", async () => {
    const out = await statuslineOutput(
      payload({ warm: true, caching_observed: true, requests: 14, hit_ratio: null }),
    );
    expect(out).not.toContain("♻");
  });

  test("requests: 2 (below meaningful threshold) → no ♻ segment", async () => {
    const out = await statuslineOutput(
      payload({ warm: true, caching_observed: true, requests: 2, hit_ratio: 0.91 }),
    );
    expect(out).not.toContain("♻");
  });

  test("no prompt_cache in payload → no ♻ segment, other chips still render", async () => {
    const out = await statuslineOutput(payload());
    expect(out).not.toContain("♻");
    expect(out).toContain("Fable 5.1");
  });

  test("mid-range hit ratio (0.42) → ♻42% in the red palette code", async () => {
    const out = await statuslineOutput(
      payload({ warm: true, caching_observed: true, requests: 14, hit_ratio: 0.42 }),
    );
    expect(out).toContain("♻42%");
    // Red ANSI escape immediately preceding the ♻ glyph (RAW_SEQUENCES.red).
    expect(out).toContain("\x1b[38;2;227;6;19m♻42%");
  });
});
