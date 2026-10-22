// cache-cold: warns the user when a prompt re-sends a large context after the
// prompt cache expired. Fixture transcripts live in a temp dir; nothing touches
// the real ~/.claude.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main } from "../src/hooks/cache-cold.ts";
import {
  COLD_RESEND_MIN_TOKENS,
  coldResend,
  readLastUsage,
  resumeColdMessage,
} from "../src/lib/cache-cold.ts";
import { captureIO } from "../src/lib/hook-runtime.ts";
import { spawnCapture } from "./support/proc.ts";

const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "cache-cold.ts");
const NOW = Date.parse("2026-10-21T18:00:00.000Z");
const HOUR = 3_600_000;

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cache-cold-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Turn {
  agoMs: number;
  tokens: number;
  model?: string;
  tier?: "5m" | "1h";
  sidechain?: boolean;
  /** Clock agoMs counts back from; the spawned hook reads the real clock. */
  base?: number;
}

function assistant({
  agoMs,
  tokens,
  model = "claude-opus-5-5",
  tier = "1h",
  sidechain,
  base = NOW,
}: Turn) {
  const write = 2_000;
  return JSON.stringify({
    type: "assistant",
    isSidechain: sidechain ?? false,
    timestamp: new Date(base - agoMs).toISOString(),
    message: {
      model,
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: tokens - write - 2,
        cache_creation_input_tokens: write,
        cache_creation: {
          ephemeral_1h_input_tokens: tier === "1h" ? write : 0,
          ephemeral_5m_input_tokens: tier === "5m" ? write : 0,
        },
        output_tokens: 300,
      },
    },
  });
}

function user(text: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: text } });
}

let n = 0;
async function transcript(lines: string[]): Promise<string> {
  const path = join(dir, `t${n++}.jsonl`);
  await writeFile(path, `${lines.join("\n")}\n`);
  return path;
}

async function notices(path: string | undefined, prompt = "keep going"): Promise<string[]> {
  const io = captureIO(JSON.stringify({ prompt, transcript_path: path }));
  await main(io, NOW);
  expect(io.contexts).toEqual([]);
  expect(io.asks).toEqual([]);
  return io.notices;
}

describe("cache-cold handler", () => {
  test("cold and large: one user notice with idle gap, size, cost and the way out", async () => {
    const path = await transcript([
      user("hi"),
      assistant({ agoMs: 2 * HOUR + 5 * 60_000, tokens: 400_000 }),
    ]);
    const out = await notices(path);
    expect(out).toHaveLength(1);
    const msg = out[0] as string;
    expect(msg).toContain("2h05m");
    expect(msg).toContain("1-hour");
    expect(msg).toContain("400k tokens");
    // Opus 5.5: $4/MTok input, 1h cache write at 2x = $8/MTok -> 400k = $3.20.
    expect(msg).toContain("$3.20");
    expect(msg).toContain("/handoff");
    expect(msg).toContain("/clear");
  });

  test("warm: silent, so the prompt after a warned one does not warn again", async () => {
    const path = await transcript([
      assistant({ agoMs: 3 * HOUR, tokens: 400_000 }),
      user("back"),
      assistant({ agoMs: 30_000, tokens: 402_000 }),
    ]);
    expect(await notices(path)).toEqual([]);
  });

  test("cold but under the threshold: silent", async () => {
    const path = await transcript([
      assistant({ agoMs: 5 * HOUR, tokens: COLD_RESEND_MIN_TOKENS - 1 }),
    ]);
    expect(await notices(path)).toEqual([]);
  });

  test("missing, unreadable, empty or absent transcript: silent", async () => {
    expect(await notices(join(dir, "nope.jsonl"))).toEqual([]);
    expect(await notices(dir)).toEqual([]); // a directory cannot be read as a file
    expect(await notices(await transcript([]))).toEqual([]);
    expect(await notices(undefined)).toEqual([]);
    expect(await notices(await transcript(["not json", "{also not"]))).toEqual([]);
  });

  test("a slash command never warns", async () => {
    const path = await transcript([assistant({ agoMs: 2 * HOUR, tokens: 400_000 })]);
    expect(await notices(path, "  /clear")).toEqual([]);
    expect(await notices(path, "/handoff")).toEqual([]);
  });

  test("a compaction newer than the last usage: silent", async () => {
    const path = await transcript([
      assistant({ agoMs: 3 * HOUR, tokens: 400_000 }),
      JSON.stringify({
        type: "system",
        subtype: "compact_boundary",
        timestamp: new Date(NOW - 2 * HOUR).toISOString(),
      }),
    ]);
    expect(await notices(path)).toEqual([]);
  });

  test("synthetic and sidechain entries do not count as the last cache use", async () => {
    const path = await transcript([
      assistant({ agoMs: 2 * HOUR, tokens: 300_000 }),
      assistant({ agoMs: 60_000, tokens: 300_000, model: "<synthetic>" }),
      assistant({ agoMs: 60_000, tokens: 300_000, sidechain: true }),
    ]);
    expect(await notices(path)).toHaveLength(1);
  });

  test("an unpriced model states tokens only", async () => {
    const path = await transcript([
      assistant({ agoMs: 2 * HOUR, tokens: 200_000, model: "claude-unknown-9" }),
    ]);
    const [msg] = await notices(path);
    expect(msg).toContain("200k tokens");
    expect(msg).not.toContain("$");
  });
});

describe("readLastUsage", () => {
  test("reads only the tail of a huge transcript", async () => {
    const pad = "x".repeat(1024 * 1024);
    const filler = Array.from({ length: 12 }, () => user(pad));
    const path = await transcript([
      // Out of the 4 MiB window: must not be found.
      assistant({ agoMs: 9 * HOUR, tokens: 999_000 }),
      ...filler,
      assistant({ agoMs: 2 * HOUR, tokens: 250_000 }),
      ...filler.slice(0, 2),
    ]);
    const started = performance.now();
    const last = await readLastUsage(path);
    expect(performance.now() - started).toBeLessThan(500);
    expect(last?.tokens).toBe(250_000);
  });

  test("an assistant entry pushed out of the window by later output: null", async () => {
    const path = await transcript([
      assistant({ agoMs: 2 * HOUR, tokens: 250_000 }),
      user("y".repeat(64 * 1024)),
    ]);
    expect(await readLastUsage(path, 32 * 1024)).toBeNull();
  });

  test("5-minute cache writes use the 5-minute TTL", async () => {
    const path = await transcript([assistant({ agoMs: 10 * 60_000, tokens: 200_000, tier: "5m" })]);
    const last = await readLastUsage(path);
    expect(last?.ttl).toBe("5m");
    const cold = last && coldResend(last, NOW);
    expect(cold?.ttl).toBe("5m");
    // Opus 5.5: 5m write at 1.25x $4 = $5/MTok -> 200k = $1.00.
    expect(cold?.usd).toBeCloseTo(1, 5);
  });

  test("exactly at the TTL is still warm", async () => {
    const path = await transcript([assistant({ agoMs: HOUR, tokens: 200_000 })]);
    const last = await readLastUsage(path);
    expect(last && coldResend(last, NOW)).toBeNull();
  });
});

describe("resume and fork (SessionStart)", () => {
  const SESSION_START = resolve(import.meta.dir, "..", "src", "scripts", "session-start.ts");
  const COLD = {
    prompt_cache_likely_expired: true,
    seconds_since_last_response: 3 * 3600 + 600,
    context_tokens: 412_000,
    estimated_cache_write_usd: 3.3,
  };

  async function run(home: string, payload: Record<string, unknown>) {
    const r = await spawnCapture(["bun", HOOK], {
      env: { HOME: home, USERPROFILE: home },
      stdin: JSON.stringify(payload),
    });
    expect(r.exit).toBe(0);
    return r.stdout;
  }

  test("an expired large resume shows the user Claude Code's idle gap, size and estimate", () => {
    expect(resumeColdMessage(COLD)).toBe(
      "[Cache] Resumed after 3h10m idle; the prompt cache has expired, so your first message " +
        "re-sends 412k tokens of context uncached, est. $3.30 by Claude Code. If the earlier " +
        "context is stale, /handoff then /clear starts the next task lighter.",
    );
  });

  test("a warm, small or malformed resume gets no warning", () => {
    expect(resumeColdMessage({ ...COLD, prompt_cache_likely_expired: false })).toBeNull();
    expect(resumeColdMessage({ ...COLD, context_tokens: 5_000 })).toBeNull();
    expect(resumeColdMessage({ ...COLD, context_tokens: "412000" })).toBeNull();
    expect(resumeColdMessage({})).toBeNull();
  });

  test("missing idle and cost fields leave those parts out", () => {
    const msg = resumeColdMessage({ prompt_cache_likely_expired: true, context_tokens: 200_000 });
    expect(msg).toStartWith("[Cache] Resumed; the prompt cache has expired");
    expect(msg).not.toContain("est.");
  });

  test("the resume warning silences the first prompt, then the transcript check resumes", async () => {
    const home = await mkdtemp(join(dir, "home-"));
    const session_id = "resumed-session";
    const out = await run(home, {
      hook_event_name: "SessionStart",
      source: "resume",
      session_id,
      ...COLD,
    });
    expect(JSON.parse(out).systemMessage).toContain("412k tokens");

    const cold = await transcript([
      assistant({ agoMs: 2 * HOUR, tokens: 300_000, base: Date.now() }),
    ]);
    const prompt = {
      hook_event_name: "UserPromptSubmit",
      session_id,
      prompt: "hi",
      transcript_path: cold,
    };
    expect(await run(home, prompt)).toBe("");
    expect(JSON.parse(await run(home, prompt)).systemMessage).toContain("300k tokens");
  }, 30_000);

  test("startup, clear and compact never warn; fork does", async () => {
    const home = await mkdtemp(join(dir, "home-"));
    for (const source of ["startup", "clear", "compact"]) {
      expect(await run(home, { hook_event_name: "SessionStart", source, ...COLD })).toBe("");
    }
    const fork = await run(home, { hook_event_name: "SessionStart", source: "fork", ...COLD });
    expect(JSON.parse(fork).systemMessage).toContain("[Cache] Resumed");
  }, 30_000);

  test("session-start.ts no longer prints a model-only cache line", async () => {
    const home = await mkdtemp(join(dir, "home-"));
    const r = await spawnCapture(["bun", SESSION_START], {
      env: { HOME: home, USERPROFILE: home, CLAUDE_PROJECT_DIR: home },
      stdin: JSON.stringify({ source: "resume", ...COLD }),
    });
    expect(r.exit).toBe(0);
    expect(r.stdout).not.toContain("[cache]");
  }, 30_000);
});

describe("cache-cold.ts as a process", () => {
  test("prints one systemMessage JSON line for a cold large session, nothing when warm", async () => {
    const base = Date.now();
    const cold = await transcript([assistant({ agoMs: 2 * HOUR, tokens: 300_000, base })]);
    const r = await spawnCapture(["bun", HOOK], {
      stdin: JSON.stringify({ prompt: "hi", transcript_path: cold }),
    });
    expect(r.exit).toBe(0);
    expect(JSON.parse(r.stdout).systemMessage).toContain("300k tokens");

    const warm = await transcript([assistant({ agoMs: 0, tokens: 300_000, base })]);
    const w = await spawnCapture(["bun", HOOK], {
      stdin: JSON.stringify({ prompt: "hi", transcript_path: warm }),
    });
    expect(w.exit).toBe(0);
    expect(w.stdout).toBe("");
  });
});
