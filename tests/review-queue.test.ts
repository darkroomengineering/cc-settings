// Review-queue backpressure tests. Pure-lib decision logic + the hook end-to-end
// (spawned with a sandboxed HOME so its ~/.claude/tmp/ state is isolated — the
// HOME-sandbox pattern from tests/phase2-scripts.test.ts).

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ageMs,
  buildNudge,
  commitSucceeded,
  formatAge,
  isCognitiveSurrender,
  isGitCommit,
  isGitPush,
  isReviewableAgent,
  maxUnreviewed,
  minReviewSeconds,
  movesHead,
  onAgentSpawn,
  onCommit,
  onHeadObserved,
  pushSucceeded,
  shouldNudge,
} from "../src/lib/review-queue.ts";

// A Bash tool_response that looks like a successful `git commit` (the
// locale-independent `[branch sha]` summary line git prints on success).
const OK_COMMIT = { stdout: "[main 1a2b3c4] wip\n 1 file changed, 2 insertions(+)", stderr: "" };

describe("review-queue lib", () => {
  test("onAgentSpawn increments and stamps firstSpawnAt on the first spawn", () => {
    const first = onAgentSpawn({ awaiting: 0 }, 1000);
    expect(first).toEqual({ awaiting: 1, firstSpawnAt: 1000 });
    // Subsequent spawns keep the original firstSpawnAt.
    const second = onAgentSpawn(first, 2000);
    expect(second).toEqual({ awaiting: 2, firstSpawnAt: 1000 });
  });

  test("onCommit resets to zero; records HEAD baseline when given", () => {
    expect(onCommit()).toEqual({ awaiting: 0 });
    expect(onCommit("abc1234")).toEqual({ awaiting: 0, lastHead: "abc1234" });
  });

  test("maxUnreviewed / minReviewSeconds: defaults, override, bad value falls back", () => {
    const savedMax = process.env.CC_MAX_UNREVIEWED;
    const savedMin = process.env.CC_MIN_REVIEW_SECONDS;
    try {
      delete process.env.CC_MAX_UNREVIEWED;
      delete process.env.CC_MIN_REVIEW_SECONDS;
      expect(maxUnreviewed()).toBe(5);
      expect(minReviewSeconds()).toBe(60);
      process.env.CC_MAX_UNREVIEWED = "3";
      process.env.CC_MIN_REVIEW_SECONDS = "90";
      expect(maxUnreviewed()).toBe(3);
      expect(minReviewSeconds()).toBe(90);
      process.env.CC_MAX_UNREVIEWED = "0";
      process.env.CC_MIN_REVIEW_SECONDS = "nope";
      expect(maxUnreviewed()).toBe(5);
      expect(minReviewSeconds()).toBe(60);
    } finally {
      restore("CC_MAX_UNREVIEWED", savedMax);
      restore("CC_MIN_REVIEW_SECONDS", savedMin);
    }
  });

  test("shouldNudge: below max false, at/over max fires, debounced within window", () => {
    const now = 1_000_000;
    expect(shouldNudge({ awaiting: 2 }, 3, now)).toBe(false);
    expect(shouldNudge({ awaiting: 3 }, 3, now)).toBe(true);
    expect(shouldNudge({ awaiting: 5, firedAt: now - 1000 }, 3, now)).toBe(false);
    expect(shouldNudge({ awaiting: 5, firedAt: now - 120_000 }, 3, now)).toBe(true);
  });

  test("ageMs: 0 when empty/unstamped, else now - firstSpawnAt (clamped)", () => {
    expect(ageMs({ awaiting: 0 }, 5000)).toBe(0);
    expect(ageMs({ awaiting: 3 }, 5000)).toBe(0); // no firstSpawnAt
    expect(ageMs({ awaiting: 3, firstSpawnAt: 1000 }, 6000)).toBe(5000);
    expect(ageMs({ awaiting: 3, firstSpawnAt: 1000 }, 500)).toBe(0);
  });

  test("formatAge: seconds, minutes, hours", () => {
    expect(formatAge(45_000)).toBe("45s");
    expect(formatAge(60_000)).toBe("1m");
    expect(formatAge(720_000)).toBe("12m");
    expect(formatAge(11_100_000)).toBe("3h05m");
  });

  test("isCognitiveSurrender: deep queue committed too fast", () => {
    const min = 60_000;
    // Deep + fast → surrender.
    expect(isCognitiveSurrender({ awaiting: 3, firstSpawnAt: 1000 }, 1000 + 59_000, 3, min)).toBe(
      true,
    );
    // Deep but slow enough → no surrender.
    expect(isCognitiveSurrender({ awaiting: 3, firstSpawnAt: 1000 }, 1000 + 61_000, 3, min)).toBe(
      false,
    );
    // Shallow queue → never surrender.
    expect(isCognitiveSurrender({ awaiting: 2, firstSpawnAt: 1000 }, 1000 + 1, 3, min)).toBe(false);
    // No marker → can't judge → false.
    expect(isCognitiveSurrender({ awaiting: 5 }, 9_999_999, 3, min)).toBe(false);
  });

  test("buildNudge mentions count, threshold, concept", () => {
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

  test("commitSucceeded: true only on the git success summary line", () => {
    // Success summaries (default, amend, root, merge, detached HEAD).
    expect(commitSucceeded({ stdout: "[main 1a2b3c4] msg" })).toBe(true);
    expect(commitSucceeded({ stdout: "[main (root-commit) 0a1b2c3] init" })).toBe(true);
    expect(commitSucceeded({ stdout: "[detached HEAD 9f8e7d6] hot" })).toBe(true);
    // Common failures that must NOT drain the queue.
    expect(commitSucceeded({ stdout: "nothing to commit, working tree clean" })).toBe(false);
    expect(commitSucceeded({ stderr: "husky - pre-commit hook exited with code 1" })).toBe(false);
    expect(commitSucceeded({ stdout: "error: cannot commit during a merge" })).toBe(false);
    // Interrupted or absent → unverified → false.
    expect(commitSucceeded({ stdout: "[main 1a2b3c4] msg", interrupted: true })).toBe(false);
    expect(commitSucceeded(undefined)).toBe(false);
  });

  test("isReviewableAgent: read-only agents don't count, writers/unknown do", () => {
    expect(isReviewableAgent("explore")).toBe(false);
    expect(isReviewableAgent("oracle")).toBe(false);
    expect(isReviewableAgent("security-reviewer")).toBe(false);
    expect(isReviewableAgent("implementer")).toBe(true);
    expect(isReviewableAgent("tester")).toBe(true);
    expect(isReviewableAgent(undefined)).toBe(true); // defaults to general-purpose (can edit)
  });

  test("isGitPush: matches real pushes, ignores lookalikes and dry-run", () => {
    expect(isGitPush("git push")).toBe(true);
    expect(isGitPush("git push origin main")).toBe(true);
    expect(isGitPush("git -C /repo push --force-with-lease")).toBe(true);
    expect(isGitPush("git push --dry-run")).toBe(false);
    expect(isGitPush("git pushup")).toBe(false);
    expect(isGitPush("git status")).toBe(false);
    expect(isGitPush("echo push")).toBe(false);
  });

  test("pushSucceeded: positive ref-update signal and no failure marker", () => {
    expect(pushSucceeded({ stderr: "   1a2b3c4..5d6e7f8  main -> main" })).toBe(true);
    expect(pushSucceeded({ stderr: " * [new branch]      feat -> feat" })).toBe(true);
    expect(pushSucceeded({ stdout: "Everything up-to-date" })).toBe(true);
    expect(pushSucceeded({ stderr: " ! [rejected]        main -> main (non-fast-forward)" })).toBe(
      false,
    );
    expect(pushSucceeded({ stderr: "fatal: Authentication failed" })).toBe(false);
    expect(pushSucceeded({ stderr: "   a..b main -> main", interrupted: true })).toBe(false);
    expect(pushSucceeded(undefined)).toBe(false);
    // No positive signal at all → not a confirmed success.
    expect(pushSucceeded({ stdout: "", stderr: "" })).toBe(false);
  });

  test("movesHead: HEAD-moving subcommands only", () => {
    for (const c of [
      "git pull",
      "git pull --ff-only",
      "git merge feat",
      "git rebase main",
      "git reset --hard HEAD~1",
      "git checkout main",
      "git switch -c feat",
      "git cherry-pick abc",
    ]) {
      expect(movesHead(c)).toBe(true);
    }
    for (const c of [
      "git status",
      "git log",
      "git diff",
      "git push",
      "git commit -m x",
      "npm run build",
    ]) {
      expect(movesHead(c)).toBe(false);
    }
  });

  test("onHeadObserved: baseline first, drain on change, no-op when same/unreadable", () => {
    // First observation → record baseline, no drain.
    expect(onHeadObserved({ awaiting: 3 }, "head1")).toEqual({ awaiting: 3, lastHead: "head1" });
    // Same HEAD → unchanged.
    expect(onHeadObserved({ awaiting: 3, lastHead: "head1" }, "head1")).toEqual({
      awaiting: 3,
      lastHead: "head1",
    });
    // HEAD advanced → drain + rebaseline.
    expect(onHeadObserved({ awaiting: 3, lastHead: "head1" }, "head2")).toEqual({
      awaiting: 0,
      lastHead: "head2",
    });
    // Unreadable HEAD (undefined) → leave untouched.
    expect(onHeadObserved({ awaiting: 3, lastHead: "head1" }, undefined)).toEqual({
      awaiting: 3,
      lastHead: "head1",
    });
  });
});

function restore(name: string, saved: string | undefined): void {
  if (saved === undefined) delete process.env[name];
  else process.env[name] = saved;
}

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
      expect(r3.stdout).toContain("Orchestration Tax"); // CC_MAX_UNREVIEWED=3
      expect((await readQueue(home))?.awaiting).toBe(3);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("a fast commit of a deep queue flags cognitive surrender, then resets", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-rq-"));
    try {
      await runHook({ tool_name: "Agent", tool_input: {} }, home);
      await runHook({ tool_name: "Agent", tool_input: {} }, home);
      await runHook({ tool_name: "Agent", tool_input: {} }, home);
      const commit = await runHook(
        {
          tool_name: "Bash",
          tool_input: { command: "git commit -m wip" },
          tool_response: OK_COMMIT,
        },
        home,
      );
      expect(commit.stdout).toContain("cognitive-surrender");
      expect((await readQueue(home))?.awaiting).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("a shallow commit neither surrenders nor errors", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-rq-"));
    try {
      await runHook({ tool_name: "Agent", tool_input: {} }, home);
      const commit = await runHook(
        {
          tool_name: "Bash",
          tool_input: { command: "git commit -m wip" },
          tool_response: OK_COMMIT,
        },
        home,
      );
      expect(commit.stdout).not.toContain("cognitive-surrender");
      expect((await readQueue(home))?.awaiting).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("a FAILED commit does not drain the queue (no success summary)", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-rq-"));
    try {
      await runHook({ tool_name: "Agent", tool_input: {} }, home);
      await runHook({ tool_name: "Agent", tool_input: {} }, home);
      // "nothing to commit" exits non-zero and prints no `[branch sha]` line.
      await runHook(
        {
          tool_name: "Bash",
          tool_input: { command: "git commit -m wip" },
          tool_response: { stdout: "nothing to commit, working tree clean", stderr: "" },
        },
        home,
      );
      expect((await readQueue(home))?.awaiting).toBe(2); // unchanged — loop never closed
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("read-only agents (explore) do not add to the review queue", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-rq-"));
    try {
      await runHook({ tool_name: "Agent", tool_input: { subagent_type: "explore" } }, home);
      await runHook({ tool_name: "Agent", tool_input: { subagent_type: "oracle" } }, home);
      // No state written at all → still null (nothing awaiting).
      expect(await readQueue(home)).toBeNull();
      // A writer agent does count.
      await runHook({ tool_name: "Agent", tool_input: { subagent_type: "implementer" } }, home);
      expect((await readQueue(home))?.awaiting).toBe(1);
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

  test("a successful git push drains the queue", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-rq-"));
    try {
      await runHook({ tool_name: "Agent", tool_input: {} }, home);
      await runHook({ tool_name: "Agent", tool_input: {} }, home);
      await runHook(
        {
          tool_name: "Bash",
          tool_input: { command: "git push origin main" },
          tool_response: { stdout: "", stderr: "   1a2b3c4..5d6e7f8  main -> main" },
        },
        home,
      );
      expect((await readQueue(home))?.awaiting).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("a REJECTED push does not drain the queue", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-rq-"));
    try {
      await runHook({ tool_name: "Agent", tool_input: {} }, home);
      await runHook({ tool_name: "Agent", tool_input: {} }, home);
      await runHook(
        {
          tool_name: "Bash",
          tool_input: { command: "git push origin main" },
          tool_response: { stdout: "", stderr: " ! [rejected]  main -> main (non-fast-forward)" },
        },
        home,
      );
      expect((await readQueue(home))?.awaiting).toBe(2);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("a HEAD-moving command with no HEAD change leaves the queue (baseline only)", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-rq-"));
    try {
      await runHook({ tool_name: "Agent", tool_input: {} }, home);
      // `git pull` reconciles HEAD; the test repo's HEAD doesn't change between
      // calls, so the first observation only records a baseline — no drain.
      await runHook(
        { tool_name: "Bash", tool_input: { command: "git pull --ff-only" }, tool_response: {} },
        home,
      );
      expect((await readQueue(home))?.awaiting).toBe(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
