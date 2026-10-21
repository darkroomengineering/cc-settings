import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, utimesSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { shouldAsk } from "../src/hooks/spawn-cap.ts";
import { spawnCapture } from "./support/proc.ts";

// Every stateful case runs in a child process: the state dir is fixed when
// platform.ts first loads, and `bun test` shares that module across test files,
// so an in-process main() would count against the real ~/.claude/tmp.
const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "spawn-cap.ts");
const DRIVER = resolve(import.meta.dir, "support", "spawn-cap-driver.ts");
const DAY_S = 24 * 60 * 60;

let home: string;
let tmp: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "spawn-cap-"));
  tmp = join(home, ".claude", "tmp");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function childEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    CC_SETTINGS_HOME: join(home, ".claude"),
    CLAUDE_CODE_SESSION_ID: undefined,
    TOOL_NAME: undefined,
    TOOL_INPUT: undefined,
  };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("TOOL_INPUT_")) env[key] = undefined;
  }
  return { ...env, ...extra };
}

interface Step {
  asks: string[];
  errors: string[];
  threw: string | null;
}

async function drive(
  via: "main" | "runHook" | "dispatch",
  payloads: string[],
  env: Record<string, string> = {},
): Promise<Step[]> {
  const { stdout, exit } = await spawnCapture(["bun", DRIVER], {
    stdin: JSON.stringify({ via, payloads }),
    env: childEnv(env),
  });
  expect(exit).toBe(0);
  const out = JSON.parse(stdout) as { tmp: string; steps: Step[] };
  expect(out.tmp).toBe(tmp);
  return out.steps;
}

function agent(sessionId: string, tool = "Agent"): string {
  return JSON.stringify({ tool_name: tool, session_id: sessionId });
}

function times(n: number, raw: string): string[] {
  return Array.from({ length: n }, () => raw);
}

function allAsks(steps: Step[]): string[] {
  return steps.flatMap((s) => s.asks);
}

async function stateFiles(): Promise<string[]> {
  try {
    return (await readdir(tmp)).filter((name) => name.startsWith("spawn-count-")).sort();
  } catch {
    return [];
  }
}

async function readCount(name: string): Promise<unknown> {
  return (JSON.parse(await readFile(join(tmp, name), "utf8")) as { count: unknown }).count;
}

async function onlyStateFile(): Promise<string> {
  const files = await stateFiles();
  expect(files).toHaveLength(1);
  const [file] = files;
  if (file === undefined) throw new Error("no spawn-count state file");
  return file;
}

describe("shouldAsk", () => {
  test.each([0, 29, 31, 44])("%d does not ask", (count) => {
    expect(shouldAsk(count)).toBe(false);
  });

  test.each([30, 45, 60])("%d asks", (count) => {
    expect(shouldAsk(count)).toBe(true);
  });
});

describe("which calls count", () => {
  test("no session id anywhere writes no state and never asks", async () => {
    const steps = await drive("main", times(30, JSON.stringify({ tool_name: "Agent" })));
    expect(allAsks(steps)).toEqual([]);
    expect(await stateFiles()).toEqual([]);
  });

  test("an unparseable payload with TOOL_NAME but no session env var is not counted", async () => {
    const steps = await drive("main", ["not json"], { TOOL_NAME: "Agent" });
    expect(allAsks(steps)).toEqual([]);
    expect(await stateFiles()).toEqual([]);
  });

  test("the env fallback counts when CLAUDE_CODE_SESSION_ID is set", async () => {
    await drive("main", ["not json"], { TOOL_NAME: "Agent", CLAUDE_CODE_SESSION_ID: "env" });
    expect(await readCount(await onlyStateFile())).toBe(1);
  });

  test.each(["Bash", "Edit"])("%s is not counted", async (tool) => {
    expect(allAsks(await drive("main", [agent("s1", tool)]))).toEqual([]);
    expect(await stateFiles()).toEqual([]);
  });

  test("Task counts toward the same session total as Agent", async () => {
    await drive("main", [agent("s1", "Task"), agent("s1", "Agent")]);
    expect(await readCount(await onlyStateFile())).toBe(2);
  });

  test("separate sessions keep separate counts", async () => {
    await drive("main", [agent("a"), agent("b"), agent("b"), agent("b")]);
    const files = await stateFiles();
    expect(files).toHaveLength(2);
    const counts = await Promise.all(files.map(readCount));
    expect(counts.sort()).toEqual([1, 3]);
  });
});

describe("corrupt state", () => {
  test.each([['{"count":"x"}'], ["[]"], ['{"count":-5}'], ["{not json"]])(
    "%s restarts the count at 1",
    async (stored) => {
      await drive("main", [agent("s1")]);
      const file = await onlyStateFile();
      await writeFile(join(tmp, file), stored);
      const [step] = await drive("main", [agent("s1")]);
      expect(step).toEqual({ asks: [], errors: [], threw: null });
      expect(await readCount(file)).toBe(1);
    },
  );
});

describe("through the dispatcher", () => {
  test("asks exactly once over the first 30 spawns, at the 30th; the 31st is silent", async () => {
    const steps = await drive("dispatch", times(31, agent("dispatch")));
    expect(steps.flatMap((s) => s.errors)).toEqual([]);
    const askedAt = steps.flatMap((s, i) => (s.asks.length > 0 ? [i + 1] : []));
    expect(askedAt).toEqual([30]);
    const reason = steps[29]?.asks[0] ?? "";
    expect(reason).toStartWith("[Spawn Cap]");
    expect(reason).toContain("30 subagents");
  });

  test("a Bash call never reaches the handler", async () => {
    expect(allAsks(await drive("dispatch", [agent("dispatch", "Bash")]))).toEqual([]);
    expect(await stateFiles()).toEqual([]);
  });
});

describe("standalone process", () => {
  test("the 30th spawn prints the PreToolUse ask envelope and exits 0", async () => {
    await drive("main", [agent("standalone")]);
    const file = await onlyStateFile();
    await writeFile(join(tmp, file), JSON.stringify({ count: 29 }));
    const { stdout, exit } = await spawnCapture(["bun", HOOK], {
      stdin: agent("standalone"),
      env: childEnv(),
    });
    expect(exit).toBe(0);
    const out = JSON.parse(stdout) as {
      hookSpecificOutput: {
        hookEventName: string;
        permissionDecision: string;
        permissionDecisionReason: string;
      };
    };
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecision).toBe("ask");
    expect(out.hookSpecificOutput.permissionDecisionReason).toStartWith("[Spawn Cap]");
    expect(await readCount(file)).toBe(30);
  });
});

describe("pruning stale state", () => {
  async function seed(name: string, ageDays: number): Promise<void> {
    await mkdir(tmp, { recursive: true });
    await writeFile(join(tmp, name), JSON.stringify({ count: 3 }));
    const at = Date.now() / 1000 - ageDays * DAY_S;
    utimesSync(join(tmp, name), at, at);
  }

  test("a session's first spawn deletes week-old counters only", async () => {
    await seed("spawn-count-old.json", 8);
    await seed("spawn-count-fresh.json", 1);
    await seed("other-old.json", 8);
    await drive("main", [agent("new-session")]);
    const names = await readdir(tmp);
    expect(names).not.toContain("spawn-count-old.json");
    expect(names).toContain("spawn-count-fresh.json");
    expect(names).toContain("other-old.json");
  });

  test("a later spawn in the session does not prune", async () => {
    await drive("main", [agent("s1")]);
    await seed("spawn-count-old.json", 8);
    await drive("main", [agent("s1")]);
    expect(await readdir(tmp)).toContain("spawn-count-old.json");
  });
});

describe("state write failure", () => {
  // chmod does not make a Windows dir read-only, and root writes through 0o500.
  const cannotDenyWrites = process.platform === "win32" || process.getuid?.() === 0;

  test.skipIf(cannotDenyWrites)("a read-only state dir fails open with no ask", async () => {
    await mkdir(tmp, { recursive: true });
    chmodSync(tmp, 0o500);
    try {
      const [bare] = await drive("main", [agent("ro")]);
      expect(bare?.threw).not.toBeNull();
      const [wrapped] = await drive("runHook", [agent("ro")]);
      expect(wrapped).toEqual({ asks: [], errors: [], threw: null });
    } finally {
      chmodSync(tmp, 0o700);
    }
  });
});
