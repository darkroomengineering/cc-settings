// Tests for readMcpFromSettings safeParse validation added in the zod-boundary
// hardening pass. The broader mcp integration tests live in phase3-libs.test.ts.

import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as colors from "../src/lib/colors.ts";
import { readMcpFromSettings } from "../src/lib/mcp.ts";

async function withTmp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "cc-mcp-schema-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("readMcpFromSettings — safeParse validation", () => {
  test("valid settings.json returns parsed servers", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "settings.json");
      await writeFile(
        path,
        JSON.stringify({
          mcpServers: {
            context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
            myhttp: { type: "http", url: "https://example.com/mcp" },
          },
        }),
      );
      const result = await readMcpFromSettings(path);
      expect(Object.keys(result).sort()).toEqual(["context7", "myhttp"]);
      expect(result.context7).toMatchObject({ command: "npx" });
    });
  });

  test("missing mcpServers key returns empty object", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "settings.json");
      await writeFile(path, JSON.stringify({ someOtherKey: true }));
      const result = await readMcpFromSettings(path);
      expect(result).toEqual({});
    });
  });

  test("mcpServers is a string (corrupt) returns {} and emits debug message", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "settings.json");
      await writeFile(path, JSON.stringify({ mcpServers: "not-an-object" }));

      const debugSpy = spyOn(colors, "debug").mockImplementation(() => {});
      try {
        const result = await readMcpFromSettings(path);
        expect(result).toEqual({});
        expect(debugSpy).toHaveBeenCalledTimes(1);
        const msg: string = debugSpy.mock.calls[0]?.[0] as string;
        expect(msg).toMatch(/failed schema validation/);
        expect(msg).toContain(path);
      } finally {
        debugSpy.mockRestore();
      }
    });
  });

  test("mcpServers value is invalid object (missing required fields) returns {} and emits debug", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "settings.json");
      // A server entry with neither `command` (stdio) nor `url` (http) — fails both union branches.
      await writeFile(path, JSON.stringify({ mcpServers: { broken: { type: "stdio" } } }));

      const debugSpy = spyOn(colors, "debug").mockImplementation(() => {});
      try {
        const result = await readMcpFromSettings(path);
        expect(result).toEqual({});
        expect(debugSpy).toHaveBeenCalledTimes(1);
      } finally {
        debugSpy.mockRestore();
      }
    });
  });

  test("one valid + one invalid server: zod fails the whole record, returns {}", async () => {
    // zod's z.record validates every value — if any entry fails, the whole parse fails.
    // This is all-or-nothing behavior by design: partial-valid state is harder to
    // reason about than a clean {} fallback with a debug log.
    await withTmp(async (dir) => {
      const path = join(dir, "settings.json");
      await writeFile(
        path,
        JSON.stringify({
          mcpServers: {
            good: { command: "npx", args: ["-y", "some-mcp"] },
            bad: { type: "http" /* missing url */ },
          },
        }),
      );

      const debugSpy = spyOn(colors, "debug").mockImplementation(() => {});
      try {
        const result = await readMcpFromSettings(path);
        // All-or-nothing: the whole block is rejected because one entry is invalid.
        expect(result).toEqual({});
        expect(debugSpy).toHaveBeenCalledTimes(1);
      } finally {
        debugSpy.mockRestore();
      }
    });
  });
});
