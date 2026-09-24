import { describe, expect, test } from "bun:test";
import {
  buildReport,
  costOf,
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
