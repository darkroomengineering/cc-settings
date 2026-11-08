// Unit tests for plugins/compaction-trigger's hook module.
//
// The module has no runtime imports (only `import type` from the ambient
// 'claude-code' package, which erases at compile time and is never resolved
// at runtime), so it loads under plain `bun test` like any other TS module.

import { describe, expect, test } from "bun:test";
import {
  isDecisionDump,
  register,
  resolveTriggerConfig,
  settingsTypesafeKey,
  shouldRequest,
  syncTypesafeKey,
} from "../plugins/compaction-trigger/hooks/trigger.ts";

describe("shouldRequest", () => {
  test("below threshold → no request", () => {
    expect(
      shouldRequest({
        tokens: 100_000,
        compactAtTokens: 150_000,
        turnsSince: 5,
        minTurnsBetween: 3,
        compacting: false,
      }),
    ).toBe(false);
  });

  test("at threshold → request", () => {
    expect(
      shouldRequest({
        tokens: 150_000,
        compactAtTokens: 150_000,
        turnsSince: 5,
        minTurnsBetween: 3,
        compacting: false,
      }),
    ).toBe(true);
  });

  test("above threshold → request", () => {
    expect(
      shouldRequest({
        tokens: 200_000,
        compactAtTokens: 150_000,
        turnsSince: 5,
        minTurnsBetween: 3,
        compacting: false,
      }),
    ).toBe(true);
  });

  test("in-flight compaction → no request even above threshold", () => {
    expect(
      shouldRequest({
        tokens: 200_000,
        compactAtTokens: 150_000,
        turnsSince: 5,
        minTurnsBetween: 3,
        compacting: true,
      }),
    ).toBe(false);
  });

  test("minTurnsBetween honoured: too soon after the last request → no request", () => {
    expect(
      shouldRequest({
        tokens: 200_000,
        compactAtTokens: 150_000,
        turnsSince: 2,
        minTurnsBetween: 3,
        compacting: false,
      }),
    ).toBe(false);
  });

  test("minTurnsBetween honoured: exactly at the wait → request", () => {
    expect(
      shouldRequest({
        tokens: 200_000,
        compactAtTokens: 150_000,
        turnsSince: 3,
        minTurnsBetween: 3,
        compacting: false,
      }),
    ).toBe(true);
  });

  test("no token reading yet (undefined) → no request", () => {
    expect(
      shouldRequest({
        tokens: undefined,
        compactAtTokens: 150_000,
        turnsSince: 5,
        minTurnsBetween: 3,
        compacting: false,
      }),
    ).toBe(false);
  });
});

describe("resolveTriggerConfig", () => {
  test("missing options fall back to defaults", () => {
    expect(resolveTriggerConfig({})).toEqual({
      compactAtTokens: 150_000,
      minTurnsBetween: 3,
    });
  });

  test("valid numeric options are read through", () => {
    expect(resolveTriggerConfig({ compactAtTokens: 120_000, minTurnsBetween: 1 })).toEqual({
      compactAtTokens: 120_000,
      minTurnsBetween: 1,
    });
  });

  test("non-numeric or non-finite options fall back to defaults", () => {
    expect(
      resolveTriggerConfig({
        compactAtTokens: "not a number" as unknown as number,
        minTurnsBetween: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({
      compactAtTokens: 150_000,
      minTurnsBetween: 3,
    });
  });
});

// --- register wiring -------------------------------------------------------
//
// A minimal fake `on`/`$` pair, just enough surface for the handler this
// plugin registers: `$.session.usage()`, `$.session.compact()`, `$.ui.log()`.

type FakeHandler = ($: unknown, event: unknown, next: (e: unknown) => unknown) => Promise<unknown>;

function fakeOn(): { on: (event: string, handler: FakeHandler) => void; get: () => FakeHandler } {
  let handler: FakeHandler | null = null;
  return {
    on: (event: string, h: FakeHandler) => {
      if (event === "turn.complete") handler = h;
    },
    get: () => {
      if (!handler) throw new Error("turn.complete handler was never registered");
      return handler;
    },
  };
}

describe("register", () => {
  test("calls $.session.compact() exactly once when over threshold and returns next(event)", async () => {
    const { on, get } = fakeOn();
    register(on as unknown as Parameters<typeof register>[0], {
      compactAtTokens: 100,
      minTurnsBetween: 0,
    });
    const handler = get();

    let compactCalls = 0;
    const logs: string[] = [];
    const $ = {
      session: {
        usage: async () => ({ context: { tokens: 200, window: 1_000_000 } }),
        compact: async () => {
          compactCalls += 1;
          return { messages: [] };
        },
      },
      ui: { log: (text: string) => logs.push(text) },
    };
    const event = { turnId: "t1" };
    const next = (e: unknown) => ({ text: "", from: e });

    const result = await handler($, event, next);

    expect(compactCalls).toBe(1);
    expect(result).toEqual({ text: "", from: event });
    expect(logs.some((l) => l.includes("requested at 200 tokens"))).toBe(true);
  });

  test("below threshold: never calls compact, still returns next(event)", async () => {
    const { on, get } = fakeOn();
    register(on as unknown as Parameters<typeof register>[0], {
      compactAtTokens: 100_000,
      minTurnsBetween: 0,
    });
    const handler = get();

    let compactCalls = 0;
    const $ = {
      session: {
        usage: async () => ({ context: { tokens: 500, window: 1_000_000 } }),
        compact: async () => {
          compactCalls += 1;
          return { messages: [] };
        },
      },
      ui: { log: () => {} },
    };
    const event = { turnId: "t1" };
    const next = (e: unknown) => ({ text: "", from: e });

    const result = await handler($, event, next);

    expect(compactCalls).toBe(0);
    expect(result).toEqual({ text: "", from: event });
  });

  test("a rejecting compact() logs a skip and still returns next(event)", async () => {
    const { on, get } = fakeOn();
    register(on as unknown as Parameters<typeof register>[0], {
      compactAtTokens: 100,
      minTurnsBetween: 0,
    });
    const handler = get();

    const logs: string[] = [];
    const $ = {
      session: {
        usage: async () => ({ context: { tokens: 200, window: 1_000_000 } }),
        compact: async () => {
          throw new Error("turn is running");
        },
      },
      ui: { log: (text: string) => logs.push(text) },
    };
    const event = { turnId: "t1" };
    const next = (e: unknown) => ({ text: "", from: e });

    const result = await handler($, event, next);

    expect(result).toEqual({ text: "", from: event });
    expect(logs.some((l) => l.includes("skipped (turn is running)"))).toBe(true);
  });

  test("minTurnsBetween: does not request again until enough turns have passed", async () => {
    const { on, get } = fakeOn();
    register(on as unknown as Parameters<typeof register>[0], {
      compactAtTokens: 100,
      minTurnsBetween: 2,
    });
    const handler = get();

    let compactCalls = 0;
    const $ = {
      session: {
        usage: async () => ({ context: { tokens: 200, window: 1_000_000 } }),
        compact: async () => {
          compactCalls += 1;
          return { messages: [] };
        },
      },
      ui: { log: () => {} },
    };
    const next = (e: unknown) => e;

    // Turn 1: turnsSinceCompaction goes 0 -> 1, below minTurnsBetween(2) → no request.
    await handler($, { turnId: "t1" }, next);
    expect(compactCalls).toBe(0);
    // Turn 2: turnsSinceCompaction goes 1 -> 2, meets minTurnsBetween(2) → request.
    await handler($, { turnId: "t2" }, next);
    expect(compactCalls).toBe(1);
    // Turn 3, right after a request reset the counter: goes 0 -> 1, below 2 again.
    await handler($, { turnId: "t3" }, next);
    expect(compactCalls).toBe(1);
  });

  test("overlapping turns cannot release an in-flight compaction guard", async () => {
    const { on, get } = fakeOn();
    register(on as unknown as Parameters<typeof register>[0], {
      compactAtTokens: 100,
      minTurnsBetween: 0,
    });
    const handler = get();
    const started = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<{ messages: never[] }>();
    let compactCalls = 0;
    const $ = {
      session: {
        usage: async () => ({ context: { tokens: 200 } }),
        compact: () => {
          compactCalls += 1;
          started.resolve();
          return finished.promise;
        },
      },
      ui: { log: () => {} },
    };
    const next = (event: unknown) => event;
    const first = handler($, { turnId: "t1" }, next);
    await started.promise;
    try {
      await handler($, { turnId: "t2" }, next);
      await handler($, { turnId: "t3" }, next);
      expect(compactCalls).toBe(1);
    } finally {
      finished.resolve({ messages: [] });
      await first;
    }
  });

  test("subagent turns bypass usage and do not increment the turn counter", async () => {
    const { on, get } = fakeOn();
    register(on as unknown as Parameters<typeof register>[0], {
      compactAtTokens: 100,
      minTurnsBetween: 2,
    });
    const handler = get();
    let compactCalls = 0;
    let usageCalls = 0;
    const $ = {
      session: {
        usage: async () => {
          usageCalls += 1;
          return { context: { tokens: 200 } };
        },
        compact: async () => {
          compactCalls += 1;
          return { messages: [] };
        },
      },
      ui: { log: () => {} },
    };
    const next = (event: unknown) => event;
    const subagent = { turnId: "agent-turn", agentId: "agent-1" };
    expect(await handler($, subagent, next)).toBe(subagent);
    await handler($, { turnId: "t1" }, next);
    expect(compactCalls).toBe(0);
    await handler($, subagent, next);
    await handler($, { turnId: "t2" }, next);
    expect(compactCalls).toBe(1);
    expect(usageCalls).toBe(2);
  });

  test("overlapping usage reads recheck the compaction guard after resolving", async () => {
    const { on, get } = fakeOn();
    register(on as unknown as Parameters<typeof register>[0], {
      compactAtTokens: 100,
      minTurnsBetween: 0,
    });
    const handler = get();
    const firstUsage = Promise.withResolvers<{ context: { tokens: number } }>();
    const secondUsage = Promise.withResolvers<{ context: { tokens: number } }>();
    const started = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<{ messages: never[] }>();
    let usageCalls = 0;
    let compactCalls = 0;
    const $ = {
      session: {
        usage: () => (++usageCalls === 1 ? firstUsage.promise : secondUsage.promise),
        compact: () => {
          compactCalls += 1;
          started.resolve();
          return finished.promise;
        },
      },
      ui: { log: () => {} },
    };
    const next = (event: unknown) => event;
    const first = handler($, { turnId: "t1" }, next);
    const second = handler($, { turnId: "t2" }, next);
    firstUsage.resolve({ context: { tokens: 200 } });
    await started.promise;
    try {
      secondUsage.resolve({ context: { tokens: 200 } });
      await second;
      await handler($, { turnId: "t3" }, next);
      expect(compactCalls).toBe(1);
    } finally {
      finished.resolve({ messages: [] });
      await first;
    }
  });

  test("failed compaction retains the turn count and a successful retry resets it", async () => {
    const { on, get } = fakeOn();
    register(on as unknown as Parameters<typeof register>[0], {
      compactAtTokens: 100,
      minTurnsBetween: 2,
    });
    const handler = get();
    let compactCalls = 0;
    const $ = {
      session: {
        usage: async () => ({ context: { tokens: 200 } }),
        compact: async () => {
          compactCalls += 1;
          if (compactCalls === 1) throw new Error("compaction unavailable");
          return { messages: [] };
        },
      },
      ui: { log: () => {} },
    };
    const next = (event: unknown) => event;
    await handler($, { turnId: "t1" }, next);
    await handler($, { turnId: "t2" }, next);
    expect(compactCalls).toBe(1);
    await handler($, { turnId: "t3" }, next);
    expect(compactCalls).toBe(2);
    await handler($, { turnId: "t4" }, next);
    expect(compactCalls).toBe(2);
  });
});

describe("syncTypesafeKey", () => {
  const fake = (settingsKey: string | undefined, envKey: string | undefined) => {
    const sets: Array<[string, string | undefined]> = [];
    const $ = {
      env: {
        get: async (name: string) => (name === "TYPESAFE_API_KEY" ? envKey : undefined),
        set: async (name: string, value: string | undefined) => {
          sets.push([name, value]);
        },
      },
      settings: {
        read: async () => (settingsKey ? { env: { TYPESAFE_API_KEY: settingsKey } } : {}),
      },
    };
    return { $, sets };
  };

  test("writes the settings key into env when the env holds a different (rotated-away) key", async () => {
    const { $, sets } = fake("new-key", "old-key");
    expect(await syncTypesafeKey($)).toBe(true);
    expect(sets).toEqual([["TYPESAFE_API_KEY", "new-key"]]);
  });

  test("writes when env is unset", async () => {
    const { $, sets } = fake("new-key", undefined);
    expect(await syncTypesafeKey($)).toBe(true);
    expect(sets).toEqual([["TYPESAFE_API_KEY", "new-key"]]);
  });

  test("no-op when env already matches settings", async () => {
    const { $, sets } = fake("same", "same");
    expect(await syncTypesafeKey($)).toBe(false);
    expect(sets).toEqual([]);
  });

  test("no-op when settings has no key: never clears an env-only key", async () => {
    const { $, sets } = fake(undefined, "env-only");
    expect(await syncTypesafeKey($)).toBe(false);
    expect(sets).toEqual([]);
  });

  test("settingsTypesafeKey ignores non-string and empty values", () => {
    expect(settingsTypesafeKey({ env: { TYPESAFE_API_KEY: "" } })).toBeUndefined();
    expect(settingsTypesafeKey({ env: { TYPESAFE_API_KEY: 7 } })).toBeUndefined();
    expect(settingsTypesafeKey({ env: "nope" })).toBeUndefined();
    expect(settingsTypesafeKey({})).toBeUndefined();
    expect(settingsTypesafeKey({ env: { TYPESAFE_API_KEY: "k" } })).toBe("k");
  });

  test("register: a $ without env/settings still compacts and logs the skipped sync", async () => {
    const { on, get } = fakeOn();
    register(on as unknown as Parameters<typeof register>[0], {
      compactAtTokens: 100,
      minTurnsBetween: 0,
    });
    const handler = get();
    let compactCalls = 0;
    const logs: string[] = [];
    const $ = {
      session: {
        usage: async () => ({ context: { tokens: 200, window: 1_000_000 } }),
        compact: async () => {
          compactCalls += 1;
          return { messages: [] };
        },
      },
      ui: { log: (text: string) => logs.push(text) },
    };
    await handler($, { turnId: "t1" }, (e: unknown) => e);
    expect(compactCalls).toBe(1);
    expect(logs.some((l) => l.includes("key sync skipped"))).toBe(true);
    expect(logs.some((l) => l.includes("requested at 200 tokens"))).toBe(true);
  });
});

describe("isDecisionDump", () => {
  test("matches fast-jev-compaction's decision lines, plain and chunked", () => {
    expect(isDecisionDump("decisions: t1:Bash:drop_call/call=0.30/result=0.18")).toBe(true);
    expect(isDecisionDump("decisions (2/3): t40:Bash:drop_call/call=0.29/result=0.15")).toBe(true);
    expect(isDecisionDump("decisions: (none)")).toBe(true);
  });

  test("leaves the summary and every other line alone", () => {
    expect(isDecisionDump("kept 234/402 messages, no summary (84% reduction)")).toBe(false);
    expect(isDecisionDump("compaction-trigger: requested at 216171 tokens")).toBe(false);
    expect(isDecisionDump("my decisions: none")).toBe(false);
  });
});
