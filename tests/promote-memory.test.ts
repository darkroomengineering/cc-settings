// promote-memory.ts tests:
//   - isAutoMemoryPath (pure gate check): posix path matches, Windows
//     backslash path still matches (#98 regression), non-matches rejected.
//   - seen-set is capped and session-keyed, written atomically (#85).
//
// The hook guards its `runHook(main)` call behind `import.meta.main` (see
// src/schemas/emit.ts / src/setup.ts for the same idiom), so importing
// isAutoMemoryPath here never triggers the hook's stdin read.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isAutoMemoryPath } from "../src/hooks/promote-memory.ts";

const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "promote-memory.ts");

describe("isAutoMemoryPath", () => {
  test("posix auto-memory path matches", () => {
    expect(isAutoMemoryPath("/Users/x/.claude/projects/foo/memory/bar.md")).toBe(true);
  });

  test("Windows backslash path still matches (#98)", () => {
    expect(isAutoMemoryPath("C:\\Users\\x\\.claude\\projects\\foo\\memory\\bar.md")).toBe(true);
  });

  test("mixed separators still match", () => {
    expect(isAutoMemoryPath("C:\\Users\\x/.claude/projects\\foo/memory\\bar.md")).toBe(true);
  });

  test("MEMORY.md itself is excluded, posix or backslash", () => {
    expect(isAutoMemoryPath("/Users/x/.claude/projects/foo/memory/MEMORY.md")).toBe(false);
    expect(isAutoMemoryPath("C:\\Users\\x\\.claude\\projects\\foo\\memory\\MEMORY.md")).toBe(false);
  });

  test("non-.md file is excluded", () => {
    expect(isAutoMemoryPath("/Users/x/.claude/projects/foo/memory/bar.txt")).toBe(false);
  });

  test("path missing /memory/ segment is excluded", () => {
    expect(isAutoMemoryPath("/Users/x/.claude/projects/foo/notes/bar.md")).toBe(false);
  });

  test("path missing /.claude/projects/ segment is excluded", () => {
    expect(isAutoMemoryPath("/Users/x/somewhere/memory/bar.md")).toBe(false);
  });
});

describe("promote-memory.ts — seen-set (e2e)", () => {
  async function writeMemoryFile(memRoot: string, name: string, type = "project"): Promise<string> {
    const dir = join(memRoot, ".claude", "projects", "proj", "memory");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${name}.md`);
    const content = `---\nname: ${name}\nmetadata:\n  type: ${type}\n---\nbody\n`;
    await writeFile(filePath, content, "utf8");
    return filePath;
  }

  async function runHook(
    filePath: string,
    home: string,
    sessionId: string,
  ): Promise<{ stdout: string; exit: number }> {
    const proc = Bun.spawn(["bun", HOOK], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    proc.stdin.write(
      JSON.stringify({ tool_input: { file_path: filePath }, session_id: sessionId }),
    );
    proc.stdin.end();
    const stdout = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    return { stdout, exit };
  }

  async function readSeenSet(home: string, sessionId: string): Promise<string[] | null> {
    try {
      const raw = await readFile(
        join(home, ".claude", ".cache", `share-nudge-seen-${sessionId}.json`),
        "utf8",
      );
      return JSON.parse(raw) as string[];
    } catch {
      return null;
    }
  }

  test("nudges once per file, then dedups on repeat", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-promo-home-"));
    const memRoot = await mkdtemp(join(tmpdir(), "cc-promo-mem-"));
    try {
      const filePath = await writeMemoryFile(memRoot, "learning-1");
      const first = await runHook(filePath, home, "sess-a");
      expect(first.exit).toBe(0);
      expect(first.stdout).toContain("/share-learning");

      const second = await runHook(filePath, home, "sess-a");
      expect(second.exit).toBe(0);
      expect(second.stdout).toBe("");

      const seen = await readSeenSet(home, "sess-a");
      expect(seen).toEqual([filePath]);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(memRoot, { recursive: true, force: true });
    }
  });

  test("seen-set is session-keyed: a different session nudges again for the same file", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-promo-home-"));
    const memRoot = await mkdtemp(join(tmpdir(), "cc-promo-mem-"));
    try {
      const filePath = await writeMemoryFile(memRoot, "learning-shared");
      await runHook(filePath, home, "sess-a");
      const otherSession = await runHook(filePath, home, "sess-b");
      expect(otherSession.stdout).toContain("/share-learning");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(memRoot, { recursive: true, force: true });
    }
  });

  test("seen-set is capped at 50 entries", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-promo-home-"));
    const memRoot = await mkdtemp(join(tmpdir(), "cc-promo-mem-"));
    try {
      const paths: string[] = [];
      for (let i = 0; i < 55; i++) {
        const filePath = await writeMemoryFile(memRoot, `entry-${i}`);
        paths.push(filePath);
        await runHook(filePath, home, "sess-cap");
      }
      const seen = await readSeenSet(home, "sess-cap");
      expect(seen).not.toBeNull();
      expect(seen?.length).toBe(50);
      // Cap keeps the most-recent entries (slice(-50)) — the last file
      // processed must still be present, the first must have been evicted.
      expect(seen).toContain(paths[paths.length - 1] ?? "");
      expect(seen).not.toContain(paths[0] ?? "");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(memRoot, { recursive: true, force: true });
    }
  }, 45_000);
});
