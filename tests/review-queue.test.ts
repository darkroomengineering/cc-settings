// Review-queue backpressure tests. Pure-lib decision logic + the hook end-to-end
// (spawned with a sandboxed HOME so its ~/.claude/tmp/ state is isolated — the
// HOME-sandbox pattern from tests/phase2-scripts.test.ts).

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildNudge,
  isGitCommit,
  maxUnreviewed,
  onAgentSpawn,
  onCommit,
  shouldNudge,
} from "../src/lib/review-queue.ts";

describe("review-queue lib", () => {
  test("onAgentSpawn increments awaiting", () => {
    expect(onAgentSpawn({ awaiting: 0 }).awaiting).toBe(1);
    expect(onAgentSpawn({ awaiting: 4 }).awaiting).toBe(5);
  });

  test("onCommit resets to zero", () => {
    expect(onCommit()).toEqual({ awaiting: 0 });
  });

  test("maxUnreviewed: default 5, env override, bad value falls back", () => {
    const saved = process.env.CC_MAX_UNREVIEWED;
    try {
      delete process.env.CC_MAX_UNREVIEWED;
      expect(maxUnreviewed()).toBe(5);
      process.env.CC_MAX_UNREVIEWED = "3";
      expect(maxUnreviewed()).toBe(3);
      process.env.CC_MAX_UNREVIEWED = "0";
      expect(maxUnreviewed()).toBe(5);
      process.env.CC_MAX_UNREVIEWED = "nonsense";
      expect(maxUnreviewed()).toBe(5);
    } finally {
      if (saved === undefined) delete process.env.CC_MAX_UNREVIEWED;
      else process.env.CC_MAX_UNREVIEWED = saved;
    }
  });

  test("shouldNudge: below max false, at/over max fires, debounced within window", () => {
    const now = 1_000_000;
    expect(shouldNudge({ awaiting: 2 }, 3, now)).toBe(false);
    expect(shouldNudge({ awaiting: 3 }, 3, now)).toBe(true);
    expect(shouldNudge({ awaiting: 5 }, 3, now)).toBe(true);
    expect(shouldNudge({ awaiting: 5, firedAt: now - 1000 }, 3, now)).toBe(false);
    expect(shouldNudge({ awaiting: 5, firedAt: now - 120_000 }, 3, now)).toBe(true);
  });

  test("buildNudge mentions the count, threshold, and concept", () => {
    const msg = buildNudge(7, 5);
    expect(msg).toContain("7");
    expect(msg).toContain("5");
    expect(msg).toContain("Orchestration Tax");
  });

  test("isGitCommit: matches real commits, ignores lookalikes", () => {
    expect(isGitCommit("git commit -m x")).toBe(true);
    expect(isGitCommit("git -C /repo commit")).toBe(true);
    expect(isGitCommit("git commit --amend --no-edit")).toBe(true);
    expect(isGitCommit("git add . && git commit -m wip")).toBe(true);
    expect(isGitCommit("git log --oneline")).toBe(false);
    expect(isGitCommit("git commit-graph write")).toBe(false);
    expect(isGitCommit("git merge --no-commit foo")).toBe(false);
    expect(isGitCommit("echo commit")).toBe(false);
    expect(isGitCommit("npm run build")).toBe(false);
  });
});

const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "review-queue-nudge.ts");

async function runHook(payload: unknown, home: string): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", HOOK], {
    env: { ...process.env, HOME: home, USERPROFILE: home, CC_MAX_UNREVIEWED: "3" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

async function readQueue(home: string): Promise<{ awaiting: number } | null> {
  try {
    return JSON.parse(
      await readFile(join(home, ".claude", "tmp", "review-queue.json"), "utf8"),
    ) as { awaiting: number };
  } catch {
    return null;
  }
}

describe("review-queue-nudge hook (e2e)", () => {
  test("Agent spawns accumulate and nudge at the threshold", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-rq-"));
    try {
      const r1 = await runHook({ tool_name: "Agent", tool_input: {} }, home);
      const r2 = await runHook({ tool_name: "Agent", tool_input: {} }, home);
      const r3 = await runHook({ tool_name: "Agent", tool_input: {} }, home);
      expect(r1.stdout).not.toContain("Orchestration Tax");
      expect(r2.stdout).not.toContain("Orchestration Tax");
      // CC_MAX_UNREVIEWED=3 → nudge on the third spawn.
      expect(r3.stdout).toContain("Orchestration Tax");
      expect((await readQueue(home))?.awaiting).toBe(3);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("git commit resets the queue", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-rq-"));
    try {
      await runHook({ tool_name: "Agent", tool_input: {} }, home);
      await runHook({ tool_name: "Agent", tool_input: {} }, home);
      expect((await readQueue(home))?.awaiting).toBe(2);
      await runHook({ tool_name: "Bash", tool_input: { command: "git commit -m wip" } }, home);
      expect((await readQueue(home))?.awaiting).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("non-Agent, non-commit tools leave the queue unchanged", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-rq-"));
    try {
      await runHook({ tool_name: "Agent", tool_input: {} }, home);
      await runHook({ tool_name: "Read", tool_input: {} }, home);
      await runHook({ tool_name: "Bash", tool_input: { command: "git status" } }, home);
      expect((await readQueue(home))?.awaiting).toBe(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
