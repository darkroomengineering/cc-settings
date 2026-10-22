import { describe, expect, test } from "bun:test";
import {
  buildCodexReport,
  buildReport,
  costOf,
  parseCodexSession,
  parseTranscript,
  projectSlug,
  promptSize,
  zero,
} from "../src/lib/token-usage.ts";

function line(requestId: string, model: string, usage: Record<string, unknown>): string {
  return JSON.stringify({ type: "assistant", requestId, message: { model, usage } });
}

const usage = {
  input_tokens: 2,
  cache_creation_input_tokens: 1000,
  cache_read_input_tokens: 9000,
  output_tokens: 100,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000 },
};

describe("parseTranscript", () => {
  test("dedupes the per-content-block lines of one request", () => {
    const text = [
      line("r1", "claude-opus-5-5", usage),
      line("r1", "claude-opus-5-5", usage),
      line("r2", "claude-opus-5-5", usage),
    ].join("\n");
    expect(parseTranscript(text)).toHaveLength(2);
  });

  test("splits cache writes by TTL and bills untyped writes at 5m", () => {
    const [typed] = parseTranscript(line("r1", "claude-opus-5-5", usage));
    expect(typed?.tokens).toEqual({
      input: 2,
      write5m: 0,
      write1h: 1000,
      cacheRead: 9000,
      output: 100,
    });
    const [legacy] = parseTranscript(
      line("r2", "claude-opus-5", { cache_creation_input_tokens: 500 }),
    );
    expect(legacy?.tokens.write5m).toBe(500);
  });

  test("skips malformed lines, non-assistant entries, and synthetic messages", () => {
    const text = [
      "{not json",
      JSON.stringify({ type: "user" }),
      line("r1", "<synthetic>", usage),
      "",
    ].join("\n");
    expect(parseTranscript(text)).toEqual([]);
  });
});

describe("costOf", () => {
  test("prices each billing type, including the 1h write multiplier", () => {
    const t = { input: 1e6, write5m: 1e6, write1h: 1e6, cacheRead: 1e6, output: 1e6 };
    expect(costOf("claude-opus-5-5", t)).toEqual({
      input: 4,
      write5m: 5,
      write1h: 8,
      cacheRead: 0.2,
      output: 20,
    });
  });

  test("prices a [1m] model id as its base model and unknown models at zero", () => {
    const t = { ...zero(), output: 1e6 };
    expect(costOf("claude-opus-5-5[1m]", t).output).toBe(20);
    expect(costOf("claude-haiku-4-5-20251001", t).output).toBe(5);
    expect(costOf("gpt-x", t).output).toBe(0);
  });

  test("switches Haiku 5.5 to its long-context rates above a 100K prompt", () => {
    const at = { ...zero(), input: 100_000, output: 1e6 };
    expect(costOf("claude-haiku-5-5", at).output).toBe(0.5);
    const over = { ...zero(), input: 200_000, output: 1000 };
    expect(costOf("claude-haiku-5-5", over).input).toBeCloseTo(0.1);
    expect(costOf("claude-haiku-5-5", over).output).toBeCloseTo(0.0025);
  });
});

describe("buildReport", () => {
  test("separates main and subagent spend and reports cold prefixes", () => {
    const main = parseTranscript(line("m1", "claude-opus-5-5", usage));
    const sub = parseTranscript(
      line("s1", "claude-sonnet-5", { ...usage, cache_read_input_tokens: 0 }),
    );
    const r = buildReport([
      {
        id: "a",
        mtimeMs: 0,
        main: { kind: "main", requests: main },
        subagents: [{ kind: "explore", requests: sub }],
      },
    ]);
    expect(r.requests).toEqual({ main: 1, subagent: 1 });
    expect(r.coldPrefix.main).toBe(promptSize(main[0]?.tokens ?? zero()));
    expect(r.byAgent.explore?.spawns).toBe(1);
    expect(r.unpricedModels).toEqual([]);
  });
});

test("projectSlug matches Claude Code's directory naming", () => {
  expect(projectSlug("/Users/frz/Developer/@darkroom/cc-settings")).toBe(
    "-Users-frz-Developer--darkroom-cc-settings",
  );
});

// Codex rollout lines, shaped like the CLI's own logs (fields only, no content).
const codexMeta = (id: string, cwd: string, source: unknown = "exec") =>
  JSON.stringify({ type: "session_meta", payload: { id, cwd, source, base_instructions: "x" } });
const codexTurn = (turnId: string, model: string) =>
  JSON.stringify({ type: "turn_context", payload: { turn_id: turnId, model } });
const codexUsage = (input: number, cached: number, output: number, reasoning: number) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  cache_write_input_tokens: 0,
  output_tokens: output,
  reasoning_output_tokens: reasoning,
  total_tokens: input + output,
});
const codexRecord = (responseId: string, turnId: string, usage: Record<string, number>) =>
  JSON.stringify({
    type: "token_usage_record",
    payload: { response_id: responseId, turn_id: turnId, usage, thread_token_usage: usage },
  });
const codexCount = (total: Record<string, number>, last: Record<string, number>) =>
  JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: total, last_token_usage: last, model_context_window: 1000 },
    },
  });

describe("parseCodexSession", () => {
  test("counts token_usage_record per response with the turn's model", () => {
    const s = parseCodexSession(
      [
        codexMeta("t1", "/repo"),
        codexTurn("turn-a", "gpt-6-astra"),
        codexRecord("r1", "turn-a", codexUsage(100, 80, 10, 4)),
        codexCount(codexUsage(100, 80, 10, 4), codexUsage(100, 80, 10, 4)),
        codexTurn("turn-b", "gpt-6-luna"),
        codexRecord("r2", "turn-b", codexUsage(200, 150, 20, 5)),
        codexCount(codexUsage(300, 230, 30, 9), codexUsage(200, 150, 20, 5)),
      ].join("\n"),
    );
    expect(s?.kind).toBe("main");
    expect(s?.cwd).toBe("/repo");
    expect(s?.requests.map((r) => [r.id, r.model, r.tokens.input])).toEqual([
      ["r1", "gpt-6-astra", 100],
      ["r2", "gpt-6-luna", 200],
    ]);
    expect(s?.peakContextShare).toBeCloseTo(0.2);
  });

  test("older rollouts: sums last_token_usage, skips repeats, ignores inherited totals", () => {
    // A forked session starts with the parent's cumulative total (5000); only
    // last_token_usage is this thread's own, and a repeated total bills nothing.
    const s = parseCodexSession(
      [
        codexMeta("t2", "/repo"),
        codexTurn("turn-a", "gpt-5.6-sol"),
        codexCount(codexUsage(5000, 0, 100, 0), codexUsage(100, 50, 10, 2)),
        codexCount(codexUsage(5000, 0, 100, 0), codexUsage(100, 50, 10, 2)),
        codexCount(codexUsage(5200, 0, 120, 0), codexUsage(200, 100, 20, 3)),
        JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: null } }),
        "not json",
      ].join("\n"),
    );
    expect(s?.requests.map((r) => r.tokens.input)).toEqual([100, 200]);
    expect(s?.requests.every((r) => r.model === "gpt-5.6-sol")).toBe(true);
  });

  test("a subagent rollout is kind subagent; a file without session_meta is skipped", () => {
    const sub = parseCodexSession(
      codexMeta("t3", "/repo", { subagent: { thread_spawn: { parent_thread_id: "t1" } } }),
    );
    expect(sub?.kind).toBe("subagent");
    expect(parseCodexSession(codexTurn("x", "gpt-6-astra"))).toBeUndefined();
  });
});

describe("buildCodexReport", () => {
  test("splits main and subagent, dedupes response ids across rollouts, reports no cost", () => {
    const main = parseCodexSession(
      [
        codexMeta("t1", "/repo"),
        codexTurn("a", "gpt-6-astra"),
        codexRecord("r1", "a", codexUsage(100, 80, 10, 4)),
      ].join("\n"),
    );
    const sub = parseCodexSession(
      [
        codexMeta("t2", "/repo", { subagent: { other: "guardian" } }),
        codexTurn("b", "gpt-6-astra"),
        codexRecord("r1", "b", codexUsage(100, 80, 10, 4)),
        codexRecord("r2", "b", codexUsage(50, 0, 5, 1)),
      ].join("\n"),
    );
    if (!main || !sub) throw new Error("fixture did not parse");
    const r = buildCodexReport([main, sub]);
    expect(r.sessions).toEqual({ main: 1, subagent: 1 });
    expect(r.requests).toEqual({ main: 1, subagent: 1 });
    expect(r.tokens.subagent).toEqual({
      input: 50,
      cached: 0,
      cacheWrite: 0,
      output: 5,
      reasoning: 1,
    });
    expect(r.byModel["gpt-6-astra"]?.input).toBe(150);
    expect(r.cost).toBeNull();
  });
});
