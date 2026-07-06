import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isWithinBoundary, toAbsolute } from "../src/lib/freeze.ts";

const CWD = "/repo";

describe("isWithinBoundary", () => {
  test("no root ⇒ always allowed", () => {
    expect(isWithinBoundary("/anywhere/file.ts", null, CWD)).toBe(true);
    expect(isWithinBoundary("/anywhere/file.ts", "", CWD)).toBe(true);
  });
  test("file inside boundary allowed", () => {
    expect(isWithinBoundary("/repo/src/a.ts", "/repo/src", CWD)).toBe(true);
  });
  test("the boundary dir itself allowed", () => {
    expect(isWithinBoundary("/repo/src", "/repo/src", CWD)).toBe(true);
  });
  test("file outside boundary blocked", () => {
    expect(isWithinBoundary("/repo/other/a.ts", "/repo/src", CWD)).toBe(false);
  });
  test("sibling-prefix is not inside (src vs src-extra)", () => {
    expect(isWithinBoundary("/repo/src-extra/a.ts", "/repo/src", CWD)).toBe(false);
  });
  test("relative file path resolved against cwd", () => {
    expect(isWithinBoundary("src/a.ts", "/repo/src", CWD)).toBe(true);
    expect(isWithinBoundary("other/a.ts", "/repo/src", CWD)).toBe(false);
  });
  test("'..' escape is blocked", () => {
    expect(isWithinBoundary("/repo/src/../secret.ts", "/repo/src", CWD)).toBe(false);
  });
  test("relative boundary resolved against cwd", () => {
    expect(isWithinBoundary("/repo/src/a.ts", "src", CWD)).toBe(true);
  });
});

// Expectations go through `resolve` rather than POSIX string literals so the
// assertions hold on Windows too (where `resolve` emits `C:\…\` backslash paths).
describe("toAbsolute", () => {
  test("relative resolves against cwd", () => {
    expect(toAbsolute("src/a.ts", CWD)).toBe(resolve(CWD, "src/a.ts"));
  });
  test("absolute unchanged", () => {
    expect(toAbsolute("/x/y.ts", CWD)).toBe(resolve(CWD, "/x/y.ts"));
  });
});

// ── Session scoping (e2e) ────────────────────────────────────────────────
// Spawns the real freeze.ts CLI / freeze-guard.ts hook with HOME sandboxed to
// a temp dir — same pattern as tests/tool-cadence.test.ts. CLAUDE_CODE_SESSION_ID
// is stripped from the base env so a real value from the host session (this
// test process may itself be running inside a Claude Code session) can't leak
// into a case that's specifically exercising "no session id available".

const FREEZE_CLI = resolve(import.meta.dir, "..", "src", "scripts", "freeze.ts");
const FREEZE_GUARD = resolve(import.meta.dir, "..", "src", "hooks", "freeze-guard.ts");

function baseEnv(home: string, sessionId?: string): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  env.HOME = home;
  env.USERPROFILE = home;
  if (sessionId !== undefined) env.CLAUDE_CODE_SESSION_ID = sessionId;
  return env;
}

async function runFreezeCli(
  args: string[],
  home: string,
  sessionId?: string,
): Promise<{ stdout: string; stderr: string; exit: number }> {
  const proc = Bun.spawn(["bun", FREEZE_CLI, ...args], {
    env: baseEnv(home, sessionId),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { stdout, stderr, exit };
}

async function runFreezeGuard(
  home: string,
  filePath: string,
  sessionId?: string,
): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", FREEZE_GUARD], {
    env: { ...baseEnv(home), TOOL_INPUT: JSON.stringify({ file_path: filePath }) },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.write(JSON.stringify(sessionId !== undefined ? { session_id: sessionId } : {}));
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

async function readFreezeState(home: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(
      await readFile(join(home, ".claude", "tmp", "freeze.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function writeFreezeState(home: string, data: unknown): Promise<void> {
  await mkdir(join(home, ".claude", "tmp"), { recursive: true });
  await writeFile(join(home, ".claude", "tmp", "freeze.json"), JSON.stringify(data));
}

describe("freeze — session scoping (e2e)", () => {
  test("set stores the current session id", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-freeze-"));
    try {
      const target = join(home, "project");
      await mkdir(target, { recursive: true });

      const { exit } = await runFreezeCli(["set", target], home, "session-A");
      expect(exit).toBe(0);

      const state = await readFreezeState(home);
      expect(state?.sessionId).toBe("session-A");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("stale session id ⇒ not frozen and the state file self-heals (root cleared)", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-freeze-"));
    try {
      const root = join(home, "project");
      await mkdir(root, { recursive: true });
      await writeFreezeState(home, { root, sessionId: "session-A" });

      const outsideFile = join(home, "elsewhere.ts");
      // Different session than the one that set the boundary ⇒ self-heal:
      // the hook must allow the edit, not block it.
      const { exit } = await runFreezeGuard(home, outsideFile, "session-B");
      expect(exit).toBe(0);

      const state = await readFreezeState(home);
      expect(state?.root ?? null).toBeNull();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("matching session id ⇒ boundary still enforced", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-freeze-"));
    try {
      const root = join(home, "project");
      await mkdir(root, { recursive: true });
      await writeFreezeState(home, { root, sessionId: "session-A" });

      const outsideFile = join(home, "elsewhere.ts");
      const { exit, stdout } = await runFreezeGuard(home, outsideFile, "session-A");
      expect(exit).toBe(2);
      expect(stdout).toContain("[Freeze]");

      // State untouched — this session's freeze is still active.
      const state = await readFreezeState(home);
      expect(state?.root).toBe(root);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("no current session id available ⇒ freeze honored as-is (staleness can't be proven)", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-freeze-"));
    try {
      const root = join(home, "project");
      await mkdir(root, { recursive: true });
      await writeFreezeState(home, { root, sessionId: "session-A" });

      const outsideFile = join(home, "elsewhere.ts");
      const { exit } = await runFreezeGuard(home, outsideFile);
      expect(exit).toBe(2);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("freeze — set target validation (e2e)", () => {
  test("set on a file path is rejected with a clear error, not a silent full lockout", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-freeze-"));
    try {
      const filePath = join(home, "package.json");
      await writeFile(filePath, "{}");

      const { exit, stderr } = await runFreezeCli(["set", filePath], home);
      expect(exit).toBe(1);
      expect(stderr).toContain("not a directory");

      const state = await readFreezeState(home);
      expect(state).toBeNull();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("set on a nonexistent path is rejected", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-freeze-"));
    try {
      const missing = join(home, "does-not-exist");
      const { exit, stderr } = await runFreezeCli(["set", missing], home);
      expect(exit).toBe(1);
      expect(stderr).toContain("does not exist");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
