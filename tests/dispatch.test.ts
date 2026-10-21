// The hook dispatcher (src/hooks/dispatch.ts) runs every synchronous handler of
// an event in one process. Two layers:
//
//   1. In-process: runHandlers with fake handlers pins the combine and failure
//      policy (deny wins, fail closed only for safety-net, matcher filtering,
//      inner timeouts).
//   2. Spawned: the real handler table behind the real command line, plus the
//      wiring in config/40-hooks.json that the table has to agree with.

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  entryTimeoutS,
  HANDLERS,
  type Handler,
  respond,
  runHandlers,
} from "../src/hooks/dispatch.ts";
import { classifyHookCommand } from "../src/lib/audit-hooks.ts";
import { matchesTool } from "../src/lib/hook-frequency.ts";
import type { HookIO } from "../src/lib/hook-runtime.ts";
import { spawnCapture } from "./support/proc.ts";

const ROOT = resolve(import.meta.dir, "..");
const DISPATCH = resolve(ROOT, "src", "hooks", "dispatch.ts");

function payload(tool: string, input: Record<string, unknown> = {}): string {
  return JSON.stringify({ tool_name: tool, tool_input: input });
}

function fake(
  name: string,
  body: (io: HookIO) => Promise<void> | void,
  extra: Partial<Handler> = {},
): Handler {
  return {
    name,
    load: async () => ({
      main: async (io: HookIO) => {
        await body(io);
      },
    }),
    ...extra,
  };
}

const safetyNet = (body: (io: HookIO) => Promise<void> | void, matcher = "Bash"): Handler =>
  fake("safety-net", body, { matcher, failClosed: "Safety Net" });

describe("runHandlers: combining", () => {
  test("a safety-net deny beats allows and the advisories after it never run", async () => {
    let advisoryRan = false;
    const result = await runHandlers(payload("Bash", { command: "x" }), [
      safetyNet((io) => io.block("[Safety Net] no")),
      fake("advisory", (io) => {
        advisoryRan = true;
        io.context("PreToolUse", "hint");
      }),
    ]);
    expect(result.block).toEqual({ handler: "safety-net", reason: "[Safety Net] no" });
    expect(result.context).toEqual([]);
    expect(advisoryRan).toBe(false);
  });

  test("the first deny reason wins over a later deny", async () => {
    const result = await runHandlers(payload("Edit"), [
      fake("first", (io) => io.block("[Harness] first")),
      fake("second", (io) => io.block("[Freeze] second")),
    ]);
    expect(result.block).toEqual({ handler: "first", reason: "[Harness] first" });
  });

  test("additionalContext from every allowing handler is kept, in order", async () => {
    const result = await runHandlers(payload("Edit"), [
      safetyNet((io) => io.context("PreToolUse", "S"), "Edit"),
      fake("a", (io) => io.context("PreToolUse", "A")),
      fake("silent", () => {}),
      fake("b", (io) => {
        io.context("PreToolUse", "B1");
        io.context("PreToolUse", "B2");
      }),
    ]);
    expect(result.block).toBeUndefined();
    expect(result.context).toEqual(["S", "A", "B1", "B2"]);
  });

  test("a deny after allows from earlier handlers still blocks", async () => {
    const result = await runHandlers(payload("Edit"), [
      fake("a", (io) => io.context("PreToolUse", "A")),
      fake("deny", (io) => io.block("[Freeze] outside")),
    ]);
    expect(result.block?.reason).toBe("[Freeze] outside");
  });
});

describe("runHandlers and respond: ask", () => {
  test("an ask alone becomes one PreToolUse ask decision, exit 0", async () => {
    const result = await runHandlers(payload("Edit"), [
      fake("guard", (io) => io.ask("[Test Guard] adds it.skip")),
    ]);
    expect(result.asks).toEqual(["[Test Guard] adds it.skip"]);
    const { stdout, exit } = respond("PreToolUse", result);
    expect(exit).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "[Test Guard] adds it.skip",
      },
    });
  });

  test("an ask and additionalContext share one envelope", async () => {
    const result = await runHandlers(payload("Edit"), [
      fake("hint", (io) => io.context("PreToolUse", "hint")),
      fake("guard", (io) => io.ask("[Test Guard] deletes tests/a.test.ts")),
    ]);
    const { stdout, exit } = respond("PreToolUse", result);
    expect(exit).toBe(0);
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "[Test Guard] deletes tests/a.test.ts",
        additionalContext: "hint",
      },
    });
  });

  test("a block beats an ask, whichever handler runs first", async () => {
    for (const handlers of [
      [
        fake("guard", (io) => io.ask("[Test Guard] x")),
        fake("deny", (io) => io.block("[Freeze] no")),
      ],
      [
        fake("deny", (io) => io.block("[Freeze] no")),
        fake("guard", (io) => io.ask("[Test Guard] x")),
      ],
    ]) {
      const { stdout, exit } = respond("PreToolUse", await runHandlers(payload("Edit"), handlers));
      expect(exit).toBe(2);
      expect(JSON.parse(stdout)).toEqual({ decision: "block", reason: "[Freeze] no" });
    }
  });

  test("two asks join their reasons with a newline, in order", async () => {
    const result = await runHandlers(payload("Bash"), [
      fake("a", (io) => io.ask("first")),
      fake("b", (io) => io.ask("second")),
    ]);
    const out = JSON.parse(respond("PreToolUse", result).stdout);
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe("first\nsecond");
  });

  test("an ask emitted after a handler timed out is dropped", async () => {
    const result = await runHandlers(payload("Edit"), [
      fake(
        "slow",
        async (io) => {
          await Bun.sleep(150);
          io.ask("late");
        },
        { timeoutS: 0.05 },
      ),
    ]);
    await Bun.sleep(200);
    expect(result.asks).toEqual([]);
    expect(respond("PreToolUse", result)).toEqual({ stdout: "", exit: 0 });
  });
});

describe("runHandlers and respond: user notice", () => {
  const prompt = JSON.stringify({ prompt: "hi" });

  test("a notice alone is a top-level systemMessage with no envelope, exit 0", async () => {
    const result = await runHandlers(prompt, [fake("cache", (io) => io.notice("[Cache] cold"))]);
    expect(result.notices).toEqual(["[Cache] cold"]);
    const { stdout, exit } = respond("UserPromptSubmit", result);
    expect(exit).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ systemMessage: "[Cache] cold" });
  });

  test("notices join with a newline and share one JSON line with the context", async () => {
    const result = await runHandlers(prompt, [
      fake("a", (io) => io.notice("first")),
      fake("hint", (io) => io.context("UserPromptSubmit", "hint")),
      fake("b", (io) => io.notice("second")),
    ]);
    const { stdout, exit } = respond("UserPromptSubmit", result);
    expect(exit).toBe(0);
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(stdout)).toEqual({
      systemMessage: "first\nsecond",
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "hint" },
    });
  });

  test("a block keeps its exact output; the notice is dropped", async () => {
    const result = await runHandlers(payload("Edit"), [
      fake("cache", (io) => io.notice("note")),
      fake("deny", (io) => io.block("[Freeze] no")),
    ]);
    const { stdout, exit } = respond("PreToolUse", result);
    expect(exit).toBe(2);
    expect(JSON.parse(stdout)).toEqual({ decision: "block", reason: "[Freeze] no" });
  });

  test("a notice emitted before a handler throws is kept, one after a timeout is dropped", async () => {
    const result = await runHandlers(prompt, [
      fake("early", (io) => {
        io.notice("kept");
        throw new Error("boom");
      }),
      fake(
        "slow",
        async (io) => {
          await Bun.sleep(150);
          io.notice("late");
        },
        { timeoutS: 0.05 },
      ),
    ]);
    await Bun.sleep(200);
    expect(result.notices).toEqual(["kept"]);
  });
});

describe("runHandlers: failures", () => {
  test("a throwing advisory handler suppresses neither the deny nor the others' context", async () => {
    const throwing = fake("boom", () => {
      throw new Error("kaput");
    });
    const allow = await runHandlers(payload("Edit"), [
      safetyNet(() => {}, "Edit"),
      throwing,
      fake("hint", (io) => io.context("PreToolUse", "hint")),
    ]);
    expect(allow.block).toBeUndefined();
    expect(allow.context).toEqual(["hint"]);
    expect(allow.errors).toEqual(["[dispatch] boom: skipped, kaput"]);

    const deny = await runHandlers(payload("Edit"), [
      throwing,
      fake("deny", (io) => io.block("[Harness] no")),
      fake("hint", (io) => io.context("PreToolUse", "hint")),
    ]);
    expect(deny.block?.reason).toBe("[Harness] no");
    expect(deny.errors).toHaveLength(1);
  });

  test("a throwing safety-net blocks, as the crashed process does", async () => {
    const result = await runHandlers(payload("Bash"), [
      safetyNet(() => {
        throw new Error("boom");
      }),
      fake("hint", (io) => io.context("PreToolUse", "hint")),
    ]);
    expect(result.block?.handler).toBe("safety-net");
    expect(result.block?.reason).toBe("[Safety Net] internal error, failing closed: boom");
    expect(result.errors).toEqual(["[Safety Net] internal error, failing closed: boom"]);
    expect(result.context).toEqual([]);
  });

  test("a safety-net that fails to load blocks; an advisory that fails to load is skipped", async () => {
    const unloadable = (name: string, extra: Partial<Handler>): Handler => ({
      name,
      ...extra,
      load: async () => {
        throw new Error("Cannot find module");
      },
    });
    const blocked = await runHandlers(payload("Bash"), [
      unloadable("safety-net", { matcher: "Bash", failClosed: "Safety Net" }),
    ]);
    expect(blocked.block?.reason).toContain("failing closed: Cannot find module");

    const skipped = await runHandlers(payload("Bash"), [
      unloadable("knowledge-hint", {}),
      fake("hint", (io) => io.context("PreToolUse", "hint")),
    ]);
    expect(skipped.block).toBeUndefined();
    expect(skipped.context).toEqual(["hint"]);
  });

  test("context a handler emitted before failing is kept", async () => {
    const result = await runHandlers(payload("Edit"), [
      fake("steer", (io) => {
        io.context("UserPromptSubmit", "steer");
        throw new Error("state write failed");
      }),
    ]);
    expect(result.context).toEqual(["steer"]);
    expect(result.errors).toEqual(["[dispatch] steer: skipped, state write failed"]);
  });

  test("a hung advisory is cut at its own timeout and its late output is dropped", async () => {
    const hung = fake(
      "slow",
      async (io) => {
        await Bun.sleep(300);
        io.context("PreToolUse", "late");
      },
      { timeoutS: 0.05 },
    );
    const t0 = performance.now();
    const result = await runHandlers(payload("Edit"), [
      hung,
      fake("hint", (io) => io.context("PreToolUse", "hint")),
    ]);
    expect(performance.now() - t0).toBeLessThan(250);
    expect(result.context).toEqual(["hint"]);
    expect(result.errors[0]).toContain("slow: skipped, timed out after");
    await Bun.sleep(350);
    expect(result.context).toEqual(["hint"]);
  });

  test("handlers are skipped once the entry timeout has no time left", async () => {
    let ran = false;
    const result = await runHandlers(
      payload("Edit"),
      [
        fake("slow", () => Bun.sleep(80), { timeoutS: 1 }),
        fake("late", () => {
          ran = true;
        }),
      ],
      0.45,
    );
    expect(ran).toBe(false);
    // The first handler is capped to what the entry timeout left, not its own 1 s.
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/^\[dispatch\] slow: skipped, timed out after \d+ms$/);
    expect(result.errors[1]).toBe("[dispatch] late: skipped, no time left");
  });
});

describe("runHandlers: matcher filtering", () => {
  test("an Edit payload never runs safety-net, a Bash payload never runs the Edit handlers", async () => {
    const ran: string[] = [];
    const handlers = [
      safetyNet(() => {
        ran.push("safety-net");
      }),
      fake("pre-edit-validate", () => void ran.push("pre-edit-validate"), { matcher: "Edit" }),
      fake("freeze-guard", () => void ran.push("freeze-guard"), { matcher: "Edit|Write" }),
      fake("knowledge-hint", () => void ran.push("knowledge-hint")),
    ];
    await runHandlers(payload("Edit"), handlers);
    expect(ran).toEqual(["pre-edit-validate", "freeze-guard", "knowledge-hint"]);
    ran.length = 0;
    await runHandlers(payload("Write"), handlers);
    expect(ran).toEqual(["freeze-guard", "knowledge-hint"]);
    ran.length = 0;
    await runHandlers(payload("Bash"), handlers);
    expect(ran).toEqual(["safety-net", "knowledge-hint"]);
    ran.length = 0;
    await runHandlers("not json{{{", handlers);
    expect(ran).toEqual(["knowledge-hint"]);
  });

  test("the tool name falls back to TOOL_NAME when the payload is not JSON", async () => {
    const ran: string[] = [];
    const prior = process.env.TOOL_NAME;
    process.env.TOOL_NAME = "Bash";
    try {
      await runHandlers("not json{{{", [safetyNet(() => void ran.push("safety-net"))]);
    } finally {
      if (prior === undefined) delete process.env.TOOL_NAME;
      else process.env.TOOL_NAME = prior;
    }
    expect(ran).toEqual(["safety-net"]);
  });
});

describe("the handler table agrees with config/40-hooks.json", () => {
  interface Group {
    matcher?: string;
    hooks: { command: string; timeout?: number; async?: boolean; onFailure?: string }[];
  }

  async function dispatchGroups(): Promise<Map<string, Group[]>> {
    const cfg = JSON.parse(await readFile(resolve(ROOT, "config", "40-hooks.json"), "utf8")) as {
      hooks: Record<string, Group[]>;
    };
    const found = new Map<string, Group[]>();
    for (const [event, groups] of Object.entries(cfg.hooks)) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          if (hook.command.includes("/hooks/dispatch.ts")) {
            expect(hook.command.endsWith(`dispatch.ts" ${event}`)).toBe(true);
            expect(hook.async).toBeUndefined();
            found.set(event, [...(found.get(event) ?? []), group]);
          }
        }
      }
    }
    return found;
  }

  const TOOLS = ["Bash", "Edit", "Write", "Agent", "Read", "Grep", "Glob", "NotebookEdit", "Task"];

  test("every dispatched event is wired, and nothing else is", async () => {
    expect([...(await dispatchGroups()).keys()].sort()).toEqual(Object.keys(HANDLERS).sort());
  });

  test("each entry's timeout is the max of its handlers'", async () => {
    const found = await dispatchGroups();
    for (const [event, handlers] of Object.entries(HANDLERS)) {
      for (const group of found.get(event) ?? []) {
        expect(group.hooks[0]?.timeout).toBe(entryTimeoutS(handlers));
      }
    }
  });

  test("the entries select exactly the tools some handler selects, each tool through one entry", async () => {
    const found = await dispatchGroups();
    for (const [event, handlers] of Object.entries(HANDLERS)) {
      const groups = found.get(event) ?? [];
      if (event === "UserPromptSubmit") {
        expect(groups.map((g) => g.matcher)).toEqual([undefined]);
        continue;
      }
      for (const tool of TOOLS) {
        const handled = handlers.some((h) => matchesTool(h.matcher ?? null, tool));
        const entries = groups.filter((g) => matchesTool(g.matcher ?? null, tool)).length;
        expect([event, tool, entries]).toEqual([event, tool, handled ? 1 : 0]);
      }
    }
  });

  test("a failed dispatcher blocks Bash calls only, as safety-net's own entry did", async () => {
    const groups = (await dispatchGroups()).get("PreToolUse") ?? [];
    for (const tool of TOOLS) {
      const failures = groups
        .filter((g) => matchesTool(g.matcher ?? null, tool))
        .map((g) => g.hooks[0]?.onFailure);
      const expected =
        tool === "Bash"
          ? ["block"]
          : ["Edit", "Write", "Agent", "Task"].includes(tool)
            ? [undefined]
            : [];
      expect([tool, failures]).toEqual([tool, expected]);
    }
  });

  test("safety-net is the one fail-closed handler, and runs first", () => {
    expect(HANDLERS.PreToolUse[0]?.name).toBe("safety-net");
    expect(HANDLERS.PreToolUse[0]?.failClosed).toBeDefined();
    expect(
      Object.values(HANDLERS)
        .flat()
        .filter((h) => h.failClosed),
    ).toHaveLength(1);
  });

  test("freeze-guard runs before pre-edit-validate, so validation cannot spend its budget", () => {
    const names = HANDLERS.PreToolUse.map((h) => h.name);
    expect(names.indexOf("freeze-guard")).toBeLessThan(names.indexOf("pre-edit-validate"));
  });

  test("spawn-cap runs right after test-protect and only on Agent and Task calls", () => {
    const names = HANDLERS.PreToolUse.map((h) => h.name);
    expect(names.indexOf("spawn-cap")).toBe(names.indexOf("test-protect") + 1);
    const spawnCap = HANDLERS.PreToolUse.find((h) => h.name === "spawn-cap");
    expect(spawnCap?.matcher).toBe("Agent|Task");
    expect(spawnCap?.failClosed).toBeUndefined();
  });

  test("visual-proof runs right after spawn-cap and only on Bash calls", () => {
    const names = HANDLERS.PreToolUse.map((h) => h.name);
    expect(names.indexOf("visual-proof")).toBe(names.indexOf("spawn-cap") + 1);
    const visualProof = HANDLERS.PreToolUse.find((h) => h.name === "visual-proof");
    expect(visualProof?.matcher).toBe("Bash");
    expect(visualProof?.timeoutS).toBe(5);
    expect(visualProof?.failClosed).toBeUndefined();
  });

  test("the hook auditor trusts each dispatcher command once dispatch.ts is in the install manifest", async () => {
    const found = await dispatchGroups();
    const files = new Map([
      ["hooks/dispatch.ts", true],
      ["bunfig.toml", true],
    ]);
    const integrity = { files, fileExists: (rel: string) => files.has(rel) };
    for (const group of [...found.values()].flat()) {
      const command = group.hooks[0]?.command ?? "";
      expect([command, classifyHookCommand(command, integrity).severity]).toEqual([
        command,
        "trusted",
      ]);
      files.set("hooks/dispatch.ts", false);
      expect(classifyHookCommand(command, integrity).severity).toBe("suspicious");
      files.set("hooks/dispatch.ts", true);
    }
  });

  test("every handler loads and exports main", async () => {
    for (const handler of Object.values(HANDLERS).flat()) {
      const mod = await handler.load();
      expect(typeof mod.main).toBe("function");
    }
  });
});

describe("dispatch.ts as a process", () => {
  async function run(
    event: string,
    stdin: string,
    env: Record<string, string | undefined> = {},
  ): Promise<{ stdout: string; exit: number; home: string }> {
    const home = await mkdtemp(join(tmpdir(), "cc-dispatch-"));
    try {
      const r = await spawnCapture(["bun", DISPATCH, event], {
        stdin,
        stderr: "ignore",
        env: {
          HOME: home,
          USERPROFILE: home,
          CC_SAFETY_GH_LOGIN: "cc-test-user",
          GH_REPO: "darkroomengineering/cc-settings",
          ...env,
        },
      });
      return { ...r, home };
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }

  const DESTRUCTIVE = "rm -rf /";

  test("a destructive Bash command prints exactly the block safety-net prints alone", async () => {
    const stdin = payload("Bash", { command: DESTRUCTIVE });
    const dispatched = await run("PreToolUse", stdin);
    const alone = await spawnCapture(["bun", resolve(ROOT, "src", "hooks", "safety-net.ts")], {
      stdin,
      stderr: "ignore",
      env: { CC_SAFETY_GH_LOGIN: "cc-test-user", GH_REPO: "darkroomengineering/cc-settings" },
    });
    expect(alone.exit).toBe(2);
    expect(dispatched.exit).toBe(2);
    expect(dispatched.stdout).toBe(alone.stdout);
    expect(JSON.parse(dispatched.stdout).decision).toBe("block");
  });

  test("a harmless Bash command allows with no output", async () => {
    const r = await run("PreToolUse", payload("Bash", { command: "bun run typecheck" }));
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("a crashing safety-net blocks a Bash call and is not consulted for Write", async () => {
    const crash = { CC_SAFETY_TEST_CRASH: "1" };
    const bash = await run("PreToolUse", payload("Bash", { command: "ls" }), crash);
    expect(bash.exit).toBe(2);
    expect(JSON.parse(bash.stdout).reason).toBe(
      "[Safety Net] internal error, failing closed: induced crash",
    );
    const write = await run(
      "PreToolUse",
      payload("Write", { file_path: join(tmpdir(), "cc-dispatch-new.ts"), content: "x" }),
      crash,
    );
    expect(write.exit).toBe(0);
    expect(write.stdout).toBe("");
  });

  test("deleting a test file asks through test-protect", async () => {
    const r = await run("PreToolUse", payload("Bash", { command: "rm tests/x.test.ts" }));
    expect(r.exit).toBe(0);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    expect(out.hookEventName).toBe("PreToolUse");
    expect(out.permissionDecision).toBe("ask");
    expect(out.permissionDecisionReason).toStartWith("[Test Guard] deletes tests/x.test.ts");
  });

  test("an Edit of a missing file is blocked by pre-edit-validate", async () => {
    const r = await run(
      "PreToolUse",
      payload("Edit", { file_path: join(tmpdir(), "cc-dispatch-missing.ts"), old_string: "a" }),
    );
    expect(r.exit).toBe(2);
    expect(JSON.parse(r.stdout).reason).toContain("[Harness] File does not exist");
  });

  test("context from a PostToolUse handler arrives in one envelope", async () => {
    const r = await run("PostToolUse", payload("Write", { file_path: "/nonexistent/Widget.tsx" }));
    expect(r.exit).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(out.hookSpecificOutput.additionalContext).toStartWith("[review] Widget.tsx edited");
  });

  test("UserPromptSubmit runs its handlers and speaks through one envelope", async () => {
    const r = await run(
      "UserPromptSubmit",
      JSON.stringify({
        session_id: "11111111-1111-4111-8111-111111111111",
        prompt: "do all of it, refactor the whole thing across the repo",
      }),
      { TYPESAFE_API_KEY: undefined },
    );
    expect(r.exit).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(out.hookSpecificOutput.additionalContext).toContain("Breadth signals in this prompt");
  });

  test("garbage input and an unknown event", async () => {
    for (const event of ["UserPromptSubmit", "PreToolUse", "PostToolUse"]) {
      const r = await run(event, "not json{{{");
      expect([event, r.exit, r.stdout]).toEqual([event, 0, ""]);
    }
    const unknown = await run("Stop", "{}");
    expect(unknown.exit).toBe(1);
  });
});
