// Unit tests for plugins/drift-fuse's hook module. The module has no runtime
// imports (only `import type` from the ambient 'claude-code' package), so it
// loads under plain `bun test`; the engine is a fake `$` with the five nouns
// the plugin calls.

import { describe, expect, test } from "bun:test";
import {
  describeToolCall,
  foldTurn,
  nextContract,
  parseOnTask,
  redirectLine,
  register,
  resolveFuseConfig,
  scoringRequest,
  scoringState,
} from "../plugins/drift-fuse/hooks/fuse.ts";

// biome-ignore lint/suspicious/noExplicitAny: test doubles for the engine surface
type Any = any;

const CONFIG = {
  driftBelow: 0.35,
  tripAfter: 2,
  onTrip: "redirect" as const,
  scope: "unattended" as const,
};

describe("resolveFuseConfig", () => {
  test("defaults", () => {
    expect(resolveFuseConfig({})).toEqual(CONFIG);
  });
  test("reads valid options and ignores bad ones", () => {
    expect(
      resolveFuseConfig({ driftBelow: 0.5, tripAfter: 3.7, onTrip: "pause", scope: "bogus" }),
    ).toEqual({
      driftBelow: 0.5,
      tripAfter: 3,
      onTrip: "pause",
      scope: "unattended",
    });
  });
});

describe("nextContract", () => {
  test("a typed task replaces the contract", () => {
    expect(nextContract("old task", "fix the login redirect on the settings page")).toBe(
      "fix the login redirect on the settings page",
    );
  });
  test("short prompts and slash commands append; pasted tool output changes nothing", () => {
    expect(nextContract("old task", "fix billing")).toBe("old task\nthen: fix billing");
    expect(nextContract("old task", "/audit perf")).toBe("old task\nthen: /audit perf");
    expect(nextContract("", "ok")).toBe("ok");
    expect(nextContract("old task", "<bash-input>ls</bash-input>")).toBe("old task");
  });
  test("the contract is capped, keeping the newest text", () => {
    const c = nextContract("x".repeat(1990), "fix billing now");
    expect(c.length).toBe(2000);
    expect(c.endsWith("then: fix billing now")).toBe(true);
  });
});

describe("describeToolCall", () => {
  test("edits, writes and bash are described; reads are not", () => {
    expect(
      describeToolCall({
        tool: "Edit",
        file_path: "/a/b.ts",
        old_string: "x",
        new_string: "y",
      } as Any),
    ).toBe("Edit /a/b.ts");
    expect(describeToolCall({ tool: "Write", file_path: "/a/c.ts", content: "" } as Any)).toBe(
      "Write /a/c.ts",
    );
    expect(
      describeToolCall({ tool: "Bash", command: "bun   test\n  tests/x.test.ts" } as Any),
    ).toBe("Bash: bun test tests/x.test.ts");
    expect(describeToolCall({ tool: "Read", file_path: "/a/b.ts" } as Any)).toBeUndefined();
  });
  test("bash commands are cut to 120 characters", () => {
    const line = describeToolCall({ tool: "Bash", command: "x".repeat(500) } as Any);
    expect(line?.length).toBe("Bash: ".length + 120);
  });
});

describe("scoring", () => {
  test("state carries the task, the actions and the answer head", () => {
    const state = scoringState("task text", { actions: ["Edit /a"], toolCalls: 3 }, "answer");
    expect(state).toEqual({ task: "task text", actions: "Edit /a", answer: "answer" });
    const readOnly = scoringState("task", { actions: [], toolCalls: 2 }, "a");
    expect(readOnly.actions).toBe("(2 read-only tool calls)");
  });
  test("request is one noul question with criteria", () => {
    const body = JSON.parse(scoringRequest({ task: "t", actions: "a", answer: "x" }));
    expect(body.model).toBe("jev-latest");
    expect(body.questions.on_task.type).toBe("noul");
    expect(body.questions.on_task.criteria.true).toBeTruthy();
  });
  test("parseOnTask reads a probability and rejects anything else", () => {
    expect(
      parseOnTask(JSON.stringify({ answers: { on_task: { type: "noul", noul: 0.82 } } })),
    ).toBe(0.82);
    expect(parseOnTask(JSON.stringify({ answers: { on_task: { noul: 1.5 } } }))).toBeNull();
    expect(parseOnTask("not json")).toBeNull();
  });
});

describe("foldTurn", () => {
  test("two drift turns trip; an on-task turn clears strikes", () => {
    let s = foldTurn({ strikes: 0, tripped: false }, 0.1, CONFIG);
    expect(s).toEqual({ strikes: 1, tripped: false });
    s = foldTurn(s, 0.9, CONFIG);
    expect(s).toEqual({ strikes: 0, tripped: false });
    s = foldTurn(foldTurn(s, 0.2, CONFIG), 0.3, CONFIG);
    expect(s).toEqual({ strikes: 2, tripped: true });
  });
  test("a tripped fuse stays tripped through an on-task turn until the prompt hook resets it", () => {
    expect(foldTurn({ strikes: 2, tripped: true }, 0.9, CONFIG)).toEqual({
      strikes: 0,
      tripped: true,
    });
  });
});

describe("redirectLine", () => {
  test("names the task head and the last actions", () => {
    const line = redirectLine("refactor   the\nparser", 2, ["Edit /a", "Bash: rm x"]);
    expect(line).toContain('("refactor the parser")');
    expect(line).toContain("Last turn: Edit /a; Bash: rm x.");
    expect(line).toContain("last 2 turns");
  });
});

// --- register wiring -------------------------------------------------------

type Handler = ($: Any, event: Any, next: (e: Any) => Any) => Any;

function fakeOn(): { on: Any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  return { on: (event: string, h: Handler) => handlers.set(event, h), handlers };
}

/** A fake engine: Jev answers `onTask` (or fails when null); the clock never
 *  wakes, so the timeout branch stays out of the race. */
function fakeEngine(onTask: number | null, key: string | undefined) {
  const logs: { text: string; to?: string }[] = [];
  const bodies: string[] = [];
  const $ = {
    env: { get: async (name: string) => (name === "TYPESAFE_API_KEY" ? key : undefined) },
    settings: { read: async () => ({}) },
    http: {
      fetch: async (_url: string, init?: { body?: string }) => {
        bodies.push(init?.body ?? "");
        if (onTask === null) throw new Error("network");
        return { ok: true, text: JSON.stringify({ answers: { on_task: { noul: onTask } } }) };
      },
    },
    clock: { sleep: () => new Promise<void>(() => {}) },
    ui: { log: (text: string, opts?: { to?: string }) => logs.push({ text, to: opts?.to }) },
  };
  return { $, logs, bodies };
}

const passthrough = (e: Any) => e;

async function runTurn(
  h: Map<string, Handler>,
  $: Any,
  origin: Any,
  tools: Any[],
  answer = "done",
) {
  const submitted = await h.get("prompt.submit")!(
    $,
    { text: "loop tick", origin, wait: false },
    passthrough,
  );
  await h.get("turn.start")!($, { text: "loop tick", turnId: "t" }, passthrough);
  for (const t of tools) await h.get("tool.call")!($, t, passthrough);
  await h.get("turn.complete")!(
    $,
    { answer, durationMs: 1, isAborted: false, turnId: "t" },
    passthrough,
  );
  return submitted;
}

const TASK = {
  text: "fix the flaky login test in tests/login.test.ts",
  origin: { kind: "composer" },
  wait: false,
};
const EDIT = { tool: "Edit", file_path: "/repo/src/billing.ts", old_string: "a", new_string: "b" };
const SCHEDULED = { kind: "scheduled-trigger" };

describe("register", () => {
  test("two off-task unattended turns trip the fuse and the next machine prompt is redirected", async () => {
    const { on, handlers } = fakeOn();
    register(on, {});
    const { $, logs, bodies } = fakeEngine(0.1, "k");
    await handlers.get("prompt.submit")!($, TASK, passthrough);
    await handlers.get("turn.start")!($, { text: TASK.text, turnId: "t0" }, passthrough);
    await handlers.get("turn.complete")!(
      $,
      { answer: "on it", durationMs: 1, isAborted: false, turnId: "t0" },
      passthrough,
    );
    // The person's own turn is not scored under the default scope.
    expect(bodies).toHaveLength(0);

    await runTurn(handlers, $, SCHEDULED, [EDIT]);
    await runTurn(handlers, $, SCHEDULED, [EDIT]);
    expect(bodies).toHaveLength(2);
    expect(JSON.parse(bodies[0]!).state.task).toBe(TASK.text);
    expect(JSON.parse(bodies[0]!).state.actions).toBe("Edit /repo/src/billing.ts");
    expect(logs.some((l) => l.text.startsWith("drift-fuse: tripped after 2"))).toBe(true);

    const third = await handlers.get("prompt.submit")!(
      $,
      { text: "tick", origin: SCHEDULED, wait: false },
      passthrough,
    );
    expect(third.context).toHaveLength(1);
    expect(third.context[0]).toContain("drift-fuse: the last 2 turns drifted");
    expect(third.context[0]).toContain("Last turn: Edit /repo/src/billing.ts.");
    // One redirect per trip.
    const fourth = await handlers.get("prompt.submit")!(
      $,
      { text: "tick", origin: SCHEDULED, wait: false },
      passthrough,
    );
    expect(fourth.context).toBeUndefined();
  });

  test("onTrip pause drops the machine prompt; a person's prompt always passes and resets", async () => {
    const { on, handlers } = fakeOn();
    register(on, { onTrip: "pause" });
    const { $, logs } = fakeEngine(0.05, "k");
    await handlers.get("prompt.submit")!($, TASK, passthrough);
    await runTurn(handlers, $, SCHEDULED, [EDIT]);
    await runTurn(handlers, $, SCHEDULED, [EDIT]);
    const dropped = await handlers.get("prompt.submit")!(
      $,
      { text: "tick", origin: SCHEDULED, wait: false },
      passthrough,
    );
    expect(dropped.drop).toContain("drift-fuse");
    expect(
      logs.some((l) => l.text.startsWith("drift-fuse: paused a scheduled-trigger prompt")),
    ).toBe(true);

    // Trip again, then the person types: passes untouched, and the fuse is reset.
    await runTurn(handlers, $, SCHEDULED, [EDIT]);
    await runTurn(handlers, $, SCHEDULED, [EDIT]);
    const typed = {
      text: "actually, rewrite billing.ts instead",
      origin: { kind: "composer" },
      wait: false,
    };
    const passed = await handlers.get("prompt.submit")!($, typed, passthrough);
    expect(passed).toBe(typed);
    const next = await handlers.get("prompt.submit")!(
      $,
      { text: "tick", origin: SCHEDULED, wait: false },
      passthrough,
    );
    expect(next.drop).toBeUndefined();
  });

  test("an on-task turn between two drifts keeps the fuse closed", async () => {
    const { on, handlers } = fakeOn();
    register(on, {});
    let onTask = 0.1;
    const { $, logs } = fakeEngine(0.1, "k");
    $.http.fetch = async () => ({
      ok: true,
      text: JSON.stringify({ answers: { on_task: { noul: onTask } } }),
    });
    await handlers.get("prompt.submit")!($, TASK, passthrough);
    await runTurn(handlers, $, SCHEDULED, [EDIT]);
    onTask = 0.9;
    await runTurn(handlers, $, SCHEDULED, [EDIT]);
    onTask = 0.1;
    await runTurn(handlers, $, SCHEDULED, [EDIT]);
    expect(logs.some((l) => l.text.includes("tripped"))).toBe(false);
  });

  test("without a key, on a Jev failure, on subagent turns, or with no tool calls, nothing is scored", async () => {
    for (const [key, onTask] of [
      [undefined, 0.1],
      ["k", null],
    ] as const) {
      const { on, handlers } = fakeOn();
      register(on, {});
      const { $, logs } = fakeEngine(onTask, key);
      await handlers.get("prompt.submit")!($, TASK, passthrough);
      await runTurn(handlers, $, SCHEDULED, [EDIT]);
      await runTurn(handlers, $, SCHEDULED, [EDIT]);
      expect(logs.filter((l) => l.text.includes("tripped"))).toHaveLength(0);
    }
    const { on, handlers } = fakeOn();
    register(on, {});
    const { $, bodies } = fakeEngine(0.1, "k");
    await handlers.get("prompt.submit")!($, TASK, passthrough);
    await runTurn(handlers, $, SCHEDULED, [{ ...EDIT, agentId: "sub" }]);
    await handlers.get("turn.complete")!(
      $,
      { answer: "x", durationMs: 1, isAborted: false, turnId: "s", agentId: "sub" },
      passthrough,
    );
    expect(bodies).toHaveLength(0);
  });

  test("a person's prompt queued mid-turn discards that turn's score", async () => {
    const { on, handlers } = fakeOn();
    register(on, { tripAfter: 1 });
    const { $, logs, bodies } = fakeEngine(0.1, "k");
    await handlers.get("prompt.submit")!($, TASK, passthrough);
    await handlers.get("prompt.submit")!(
      $,
      { text: "tick", origin: SCHEDULED, wait: false },
      passthrough,
    );
    await handlers.get("turn.start")!($, { text: "tick", turnId: "t1" }, passthrough);
    await handlers.get("tool.call")!($, EDIT, passthrough);
    // Typed while t1 runs: the contract moves on before t1 is scored.
    await handlers.get("prompt.submit")!(
      $,
      {
        text: "now rewrite billing.ts from scratch",
        origin: { kind: "composer" },
        wait: false,
        turnId: "t1",
      },
      passthrough,
    );
    await handlers.get("turn.complete")!(
      $,
      { answer: "done", durationMs: 1, isAborted: false, turnId: "t1" },
      passthrough,
    );
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0]!).state.task).toBe(TASK.text);
    expect(logs.some((l) => l.text.includes("tripped"))).toBe(false);
  });

  test("scope all scores the person's own turns", async () => {
    const { on, handlers } = fakeOn();
    register(on, { scope: "all" });
    const { $, bodies } = fakeEngine(0.9, "k");
    await handlers.get("prompt.submit")!($, TASK, passthrough);
    await handlers.get("turn.start")!($, { text: TASK.text, turnId: "t0" }, passthrough);
    await handlers.get("tool.call")!($, EDIT, passthrough);
    await handlers.get("turn.complete")!(
      $,
      { answer: "done", durationMs: 1, isAborted: false, turnId: "t0" },
      passthrough,
    );
    expect(bodies).toHaveLength(1);
  });
});
