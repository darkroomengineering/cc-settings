// Unit tests for the small shared libs: platform, packages, json-io.
// (The MCP merge integration tests live in tests/mcp.test.ts.)

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
