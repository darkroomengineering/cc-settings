// Unit tests for the small shared libs: platform, packages, json-io.
// (The MCP merge integration tests live in tests/mcp.test.ts.)

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pointLatest } from "../src/lib/artifact-store.ts";
import { getClaudeMdMonitor } from "../src/lib/hook-config.ts";
import { isUnsafeTarEntry } from "../src/lib/install-cmds.ts";
import { atomicWriteJson, JsonParseError, readJsonOrNull } from "../src/lib/json-io.ts";
import { getInstallHint } from "../src/lib/packages.ts";
import { getTimestamp, hasCommand, os } from "../src/lib/platform.ts";

describe("platform", () => {
  test("os is one of the known values", () => {
    expect(["macos", "linux", "wsl", "windows", "unknown"]).toContain(os);
  });
  test("getTimestamp is 14 digits", () => {
    expect(getTimestamp()).toMatch(/^\d{14}$/);
  });
  test("hasCommand('bun') is true in this test env", () => {
    expect(hasCommand("bun")).toBe(true);
  });
  test("hasCommand('definitely-not-a-cmd-xyz') is false", () => {
    expect(hasCommand("definitely-not-a-cmd-xyz")).toBe(false);
  });
});

describe("packages", () => {
  test("getInstallHint returns a platform-appropriate hint", () => {
    const hint = getInstallHint("jq");
    expect(hint).toContain("jq");
  });
});

describe("json-io — atomic IO", () => {
  test("atomicWriteJson writes then renames, no tmp left on success", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-aw-"));
    try {
      const target = join(sandbox, "config.json");
      await atomicWriteJson(target, { a: 1, b: "two" });
      const roundtrip = JSON.parse(await readFile(target, "utf8"));
      expect(roundtrip).toEqual({ a: 1, b: "two" });
      // No leftover staging files.
      const { readdirSync } = await import("node:fs");
      const entries = readdirSync(sandbox);
      expect(entries).toEqual(["config.json"]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("readJsonOrNull returns null for missing file", async () => {
    const v = await readJsonOrNull(join(tmpdir(), "cc-missing-file-xyz.json"));
    expect(v).toBeNull();
  });

  test("readJsonOrNull throws JsonParseError on bad JSON", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-bad-"));
    try {
      const target = join(sandbox, "bad.json");
      await writeFile(target, "{this is not valid json");
      await expect(readJsonOrNull(target)).rejects.toBeInstanceOf(JsonParseError);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("readJsonOrNull rethrows non-parse I/O errors as-is (EISDIR is not 'invalid JSON')", async () => {
    // Reading a directory fails with EISDIR — that's an I/O problem, not a
    // corrupt file. It must NOT be wrapped as JsonParseError, which would
    // misdiagnose ("fix it or restore a backup") a permissions/path mistake.
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-eisdir-"));
    try {
      let caught: unknown;
      try {
        await readJsonOrNull(sandbox); // a directory, not a file
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught).not.toBeInstanceOf(JsonParseError);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

describe("hook-config — falsy-zero regression", () => {
  const ENV_KEYS = ["CC_CLAUDE_MD_WARN_LINES", "CC_CLAUDE_MD_CRITICAL_LINES"] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("CC_CLAUDE_MD_WARN_LINES='0' is honored as 0, not the 400 default", async () => {
    // A `parseInt(...) || fallback` bug would read explicit "0" as falsy and
    // silently revive the 400 default.
    saved.CC_CLAUDE_MD_WARN_LINES = process.env.CC_CLAUDE_MD_WARN_LINES;
    process.env.CC_CLAUDE_MD_WARN_LINES = "0";
    const { warnLines } = await getClaudeMdMonitor();
    expect(warnLines).toBe(0);
  });

  test("CC_CLAUDE_MD_CRITICAL_LINES unset still falls back to the 600 default", async () => {
    saved.CC_CLAUDE_MD_CRITICAL_LINES = process.env.CC_CLAUDE_MD_CRITICAL_LINES;
    delete process.env.CC_CLAUDE_MD_CRITICAL_LINES;
    const { criticalLines } = await getClaudeMdMonitor();
    expect(criticalLines).toBe(600);
  });

  test("an unparseable value falls back to the default (NaN, not 0)", async () => {
    saved.CC_CLAUDE_MD_WARN_LINES = process.env.CC_CLAUDE_MD_WARN_LINES;
    process.env.CC_CLAUDE_MD_WARN_LINES = "not-a-number";
    const { warnLines } = await getClaudeMdMonitor();
    expect(warnLines).toBe(400);
  });
});

describe("install-cmds — isUnsafeTarEntry (path-traversal guard)", () => {
  test("absolute path entries are unsafe", () => {
    expect(isUnsafeTarEntry("/etc/passwd")).toBe(true);
  });

  test("'..' path segments are unsafe", () => {
    expect(isUnsafeTarEntry("../../etc/passwd")).toBe(true);
    expect(isUnsafeTarEntry(".claude/../../etc/passwd")).toBe(true);
  });

  test("ordinary relative archive entries are safe", () => {
    expect(isUnsafeTarEntry(".claude/settings.json")).toBe(false);
    expect(isUnsafeTarEntry(".claude.json")).toBe(false);
    expect(isUnsafeTarEntry("settings.json")).toBe(false);
  });

  test("a filename that merely contains '..' as a substring (not a segment) is safe", () => {
    expect(isUnsafeTarEntry(".claude/weird..name.json")).toBe(false);
  });
});

describe("artifact-store — pointLatest atomicity", () => {
  test("creates a symlink pointing at the target's basename", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-artifact-pl-"));
    try {
      const target = join(sandbox, "chk-1.json");
      await writeFile(target, "{}");
      await pointLatest(sandbox, target, "latest");
      expect(await readlink(join(sandbox, "latest"))).toBe("chk-1.json");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("repointing an existing link leaves no leftover .tmp staging file", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-artifact-pl-"));
    try {
      const t1 = join(sandbox, "chk-1.json");
      const t2 = join(sandbox, "chk-2.json");
      await writeFile(t1, "{}");
      await writeFile(t2, "{}");
      await pointLatest(sandbox, t1, "latest");
      await pointLatest(sandbox, t2, "latest"); // repoint — exercises the rename-over-existing-link path
      expect(await readlink(join(sandbox, "latest"))).toBe("chk-2.json");
      const entries = await readdir(sandbox);
      expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
      expect(existsSync(join(sandbox, "latest"))).toBe(true);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
