import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnCapture } from "./support/proc.ts";

const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "tool-cadence.ts");

test("a nudge persists legacy fields and debounces the next spawn", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-cadence-"));
  const stateDir = join(home, ".claude", "tmp");
  const stateFile = join(stateDir, "review-queue.json");
  const firstSpawnAt = Date.now() - 1000;
  const env = { HOME: home, USERPROFILE: home, CC_MAX_UNREVIEWED: "3" };
  const stdin = JSON.stringify({ tool_name: "Agent", tool_input: {} });
  try {
    await mkdir(stateDir, { recursive: true });
    await writeFile(stateFile, JSON.stringify({ awaiting: 2, firstSpawnAt, lastHead: "head1" }));
    const before = Date.now();
    const first = await spawnCapture(["bun", HOOK], { env, stdin });
    expect(first.exit).toBe(0);
    expect(first.stdout).toContain("Review queue: 3");
    const nudged = JSON.parse(await readFile(stateFile, "utf8"));
    expect(nudged).toEqual({
      awaiting: 3,
      firstSpawnAt,
      firedAt: expect.any(Number),
      lastHead: "head1",
    });
    expect(nudged.firedAt).toBeGreaterThanOrEqual(before);
    expect(nudged.firedAt).toBeLessThanOrEqual(Date.now());

    const second = await spawnCapture(["bun", HOOK], { env, stdin });
    expect(second.exit).toBe(0);
    expect(second.stdout).not.toContain("Review queue:");
    expect(JSON.parse(await readFile(stateFile, "utf8"))).toEqual({ ...nudged, awaiting: 4 });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("an inconsistent disk queue starts a fresh pending queue on spawn", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-cadence-"));
  const stateDir = join(home, ".claude", "tmp");
  const stateFile = join(stateDir, "review-queue.json");
  try {
    await mkdir(stateDir, { recursive: true });
    await writeFile(stateFile, JSON.stringify({ awaiting: 3, lastHead: "head1" }));
    const before = Date.now();
    const result = await spawnCapture(["bun", HOOK], {
      env: { HOME: home, USERPROFILE: home, CC_MAX_UNREVIEWED: "3" },
      stdin: JSON.stringify({ tool_name: "Agent", tool_input: {} }),
    });
    expect(result.exit).toBe(0);
    expect(result.stdout).not.toContain("Review queue:");
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    expect(state).toEqual({ awaiting: 1, firstSpawnAt: expect.any(Number), lastHead: "head1" });
    expect(state.firstSpawnAt).toBeGreaterThanOrEqual(before);
    expect(state.firstSpawnAt).toBeLessThanOrEqual(Date.now());
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("irrelevant Read and Write calls emit nothing and create no state", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-cadence-"));
  try {
    for (const toolName of ["Read", "Write"]) {
      const result = await spawnCapture(["bun", HOOK], {
        env: { HOME: home, USERPROFILE: home },
        stdin: JSON.stringify({ tool_name: toolName, tool_input: { file_path: "/tmp/file.ts" } }),
        stderr: "ignore",
      });
      expect(result.exit).toBe(0);
      expect(result.stdout.trim()).toBe("");
    }
    expect(existsSync(join(home, ".claude"))).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
