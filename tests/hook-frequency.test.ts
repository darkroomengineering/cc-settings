import { describe, expect, test } from "bun:test";
import {
  countTranscript,
  emptyCounts,
  firingsFor,
  flattenHooks,
  matchesFilter,
  matchesTool,
  median,
  percentile,
} from "../src/lib/hook-frequency.ts";

const config = {
  hooks: {
    PreToolUse: [
      {
        matcher: "Edit|Write",
        hooks: [{ type: "command", command: 'bun "$HOME/.claude/src/hooks/freeze-guard.ts"' }],
      },
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            if: "Bash(gh*pr create*) Bash(gh*pr ready*)",
            command: 'bun "$HOME/.claude/src/hooks/pre-pr-proof.ts"',
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "Write|Edit",
        hooks: [{ type: "command", command: 'bun "$HOME/.claude/src/scripts/post-edit.ts"' }],
      },
    ],
    UserPromptSubmit: [
      { hooks: [{ type: "command", command: 'bun "$HOME/.claude/src/hooks/quota-steer.ts"' }] },
    ],
    SubagentStart: [
      {
        hooks: [
          {
            type: "command",
            command: 'bun "$HOME/.claude/src/scripts/swarm-log.ts" start',
            async: true,
          },
        ],
      },
    ],
    Notification: [
      { hooks: [{ type: "command", command: 'bun "$HOME/.claude/src/scripts/notify.ts"' }] },
    ],
  },
};

const use = (id: string, name: string, input: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
const result = (id: string, isError: boolean) =>
  JSON.stringify({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: "x" }],
    },
  });
const prompt = (text: string) =>
  JSON.stringify({ type: "user", message: { role: "user", content: text } });

const transcript = [
  prompt("fix it"),
  use("t1", "Edit"),
  use("t1", "Edit"), // repeated line for the same content block
  result("t1", false),
  use("t2", "Write"),
  result("t2", true),
  use("t3", "Bash", { command: "gh pr create --fill" }),
  result("t3", false),
  use("t4", "Bash", { command: "ls" }),
  result("t4", false),
  use("t5", "Agent"),
  JSON.stringify({ type: "user", isMeta: true, message: { content: "meta" } }),
  JSON.stringify({ type: "system", subtype: "compact_boundary" }),
  JSON.stringify({ type: "system", subtype: "turn_duration", durationMs: 1000 }),
  JSON.stringify({
    type: "system",
    subtype: "stop_hook_summary",
    hookInfos: [
      { command: "a", durationMs: 40 },
      { command: "b", durationMs: 90 },
    ],
  }),
  "{not json",
].join("\n");

describe("flattenHooks", () => {
  test("derives ids from the script name and trailing argument", () => {
    const ids = flattenHooks(config).map((e) => e.id);
    expect(ids).toEqual([
      "freeze-guard",
      "pre-pr-proof",
      "post-edit",
      "quota-steer",
      "swarm-log start",
      "notify",
    ]);
    expect(flattenHooks(config).find((e) => e.id === "swarm-log start")?.async).toBe(true);
  });
});

describe("matchers", () => {
  test("match the whole tool name", () => {
    expect(matchesTool("Edit", "Edit")).toBe(true);
    expect(matchesTool("Edit", "MultiEdit")).toBe(false);
    expect(matchesTool("Write|Edit", "Write")).toBe(true);
    expect(matchesTool(null, "Anything")).toBe(true);
  });

  test("if filters glob the Bash command and keep the rule's tool", () => {
    const f = "Bash(gh*pr create*) Bash(gh*pr ready*)";
    expect(matchesFilter(f, "Bash", "gh pr create --fill")).toBe(true);
    expect(matchesFilter(f, "Bash", "gh pr ready 12")).toBe(true);
    expect(matchesFilter(f, "Bash", "gh pr view")).toBe(false);
    expect(matchesFilter(f, "Edit", "")).toBe(false);
    expect(matchesFilter(null, "Edit", "")).toBe(true);
  });
});

describe("countTranscript and firingsFor", () => {
  const s = emptyCounts("s1");
  countTranscript(transcript, s, true);
  const by = (id: string) => {
    const e = flattenHooks(config).find((h) => h.id === id);
    if (!e) throw new Error(id);
    return firingsFor(e, s);
  };

  test("counts deduped tool calls, prompts, compactions, turns and spawns", () => {
    expect(s.calls.map((c) => c.tool)).toEqual(["Edit", "Write", "Bash", "Bash", "Agent"]);
    expect(s.prompts).toBe(1);
    expect(s.compactions).toBe(1);
    expect(s.turns).toBe(1);
    expect(s.subagentSpawns).toBe(1);
    expect(s.activeMs).toBe(1000);
    expect(s.stopHooks).toEqual([
      { command: "a", durationMs: 40 },
      { command: "b", durationMs: 90 },
    ]);
    expect(s.stopWallMs).toEqual([90]);
  });

  test("maps matchers to firings", () => {
    expect(by("freeze-guard")).toBe(2); // Edit + Write
    expect(by("pre-pr-proof")).toBe(1); // only the gh pr create call
    expect(by("quota-steer")).toBe(1);
    expect(by("swarm-log start")).toBe(1);
  });

  test("a failed call fires no PostToolUse, and an event without a record is null", () => {
    expect(by("post-edit")).toBe(1); // the failed Write is excluded
    expect(by("notify")).toBeNull();
  });
});

describe("percentile", () => {
  test("uses nearest rank", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([], 50)).toBe(0);
  });
});
