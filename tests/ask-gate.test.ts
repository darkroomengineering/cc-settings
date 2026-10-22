// ask-gate Stop hook: blocks a turn that ends in a prose question with no
// AskUserQuestion call; everything else (and every failure) allows the stop.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "ask-gate.ts");

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ask-gate-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const user = (text: string) => ({ type: "user", message: { role: "user", content: text } });
const toolResult = {
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
};
const assistant = (...blocks: object[]) => ({
  type: "assistant",
  message: { role: "assistant", content: blocks },
});
const text = (t: string) => ({ type: "text", text: t });
const askTool = { type: "tool_use", id: "t2", name: "AskUserQuestion", input: {} };

async function run(entries: object[] | null, extra: object = {}) {
  const path = join(dir, `t-${Math.random().toString(36).slice(2)}.jsonl`);
  if (entries) await writeFile(path, entries.map((e) => JSON.stringify(e)).join("\n"));
  const proc = Bun.spawn(["bun", HOOK], {
    stdin: new Blob([JSON.stringify({ transcript_path: path, ...extra })]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: dir },
  });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { out: out.trim(), code };
}

describe("ask-gate", () => {
  test("prose question at the end blocks", async () => {
    const r = await run([user("go"), assistant(text("Which option do you want?"))]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).decision).toBe("block");
  });

  test("AskUserQuestion in the final turn allows", async () => {
    const r = await run([
      user("go"),
      assistant(text("Which option do you want?"), askTool),
      toolResult,
      assistant(text("Which one?")),
    ]);
    expect(r.out).toBe("");
  });

  test("an earlier turn's AskUserQuestion does not cover a later prose question", async () => {
    const r = await run([
      user("go"),
      assistant(askTool),
      user("option A"),
      assistant(text("Shall I continue?")),
    ]);
    expect(JSON.parse(r.out).decision).toBe("block");
  });

  test("a bold or code-wrapped question still blocks", async () => {
    for (const q of ["**Which option should I use?**", "Run `bun test`?`", "_Keep going?_"]) {
      const r = await run([user("go"), assistant(text(q))]);
      expect(JSON.parse(r.out).decision).toBe("block");
    }
  });

  test("a turn that starts before the 256 KB tail allows", async () => {
    const bulk = {
      ...toolResult,
      message: {
        ...toolResult.message,
        content: [{ type: "tool_result", tool_use_id: "t1", content: "x".repeat(300 * 1024) }],
      },
    };
    const r = await run([user("go"), assistant(askTool), bulk, assistant(text("Which one?"))]);
    expect(r.out).toBe("");
  });

  test("statement ending allows", async () => {
    const r = await run([user("go"), assistant(text("Why? Because it works. Done."))]);
    expect(r.out).toBe("");
  });

  test("question only inside a code block allows", async () => {
    const r = await run([
      user("go"),
      assistant(text("Here is the snippet.\n```\nwhat is this?\n```\nDone.")),
    ]);
    expect(r.out).toBe("");
  });

  test("stop_hook_active allows", async () => {
    const r = await run([user("go"), assistant(text("Which one?"))], { stop_hook_active: true });
    expect(r.out).toBe("");
    expect(r.code).toBe(0);
  });

  test("unreadable transcript allows with exit 0", async () => {
    const r = await run(null);
    expect(r).toEqual({ out: "", code: 0 });
  });
});
