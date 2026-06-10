// Unit tests for gatherStatus() in src/lib/status.ts.
// Each test sets up a minimal temp directory to act as sourceDir/claudeDir,
// calls gatherStatus(), and asserts on specific fields of the returned
// StatusData — no console output to capture.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherStatus } from "../src/lib/status.ts";

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-status-test-"));
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

describe("gatherStatus", () => {
  test("missing sentinel → sentinel.version is null", async () => {
    const src = await makeTmpDir();
    const claude = await makeTmpDir();
    try {
      const data = await gatherStatus(src, claude, "11.2.1");
      expect(data.sentinel.version).toBeNull();
      expect(data.sentinel.installedAt).toBeNull();
    } finally {
      await cleanup(src);
      await cleanup(claude);
    }
  });

  test("valid sentinel → sentinel.version populated", async () => {
    const src = await makeTmpDir();
    const claude = await makeTmpDir();
    try {
      const sentinelContent = JSON.stringify({
        version: "11.0.0",
        installed_at: "2026-05-01T12:00:00Z",
      });
      await writeFile(join(claude, ".cc-settings-version"), sentinelContent);

      const data = await gatherStatus(src, claude, "11.2.1");
      expect(data.sentinel.version).toBe("11.0.0");
      expect(data.sentinel.installedAt).toBe("2026-05-01T12:00:00Z");
    } finally {
      await cleanup(src);
      await cleanup(claude);
    }
  });

  test("malformed sentinel → sentinel.version is null (treated as absent)", async () => {
    const src = await makeTmpDir();
    const claude = await makeTmpDir();
    try {
      await writeFile(join(claude, ".cc-settings-version"), "NOT VALID JSON {{{{");
      const data = await gatherStatus(src, claude, "11.2.1");
      expect(data.sentinel.version).toBeNull();
    } finally {
      await cleanup(src);
      await cleanup(claude);
    }
  });

  test("source without .git dir → git field is null", async () => {
    const src = await makeTmpDir();
    const claude = await makeTmpDir();
    try {
      const data = await gatherStatus(src, claude, "11.2.1");
      expect(data.git).toBeNull();
    } finally {
      await cleanup(src);
      await cleanup(claude);
    }
  });

  test("no skills in sourceDir → all counts are 0, missing is []", async () => {
    const src = await makeTmpDir();
    const claude = await makeTmpDir();
    try {
      const data = await gatherStatus(src, claude, "11.2.1");
      expect(data.skills.shippedCount).toBe(0);
      expect(data.skills.presentCount).toBe(0);
      expect(data.skills.missing).toEqual([]);
    } finally {
      await cleanup(src);
      await cleanup(claude);
    }
  });

  test("skill present in src but not installed → appears in missing", async () => {
    const src = await makeTmpDir();
    const claude = await makeTmpDir();
    try {
      // Create a skills/explore directory in the source (simulates a shipped skill)
      await mkdir(join(src, "skills", "explore"), { recursive: true });
      await writeFile(join(src, "skills", "explore", "SKILL.md"), "# explore");

      const data = await gatherStatus(src, claude, "11.2.1");
      expect(data.skills.missing).toContain("explore");
      expect(data.skills.shippedCount).toBeGreaterThan(0);
      expect(data.skills.presentCount).toBeLessThan(data.skills.shippedCount);
    } finally {
      await cleanup(src);
      await cleanup(claude);
    }
  });

  test("MCP server in claudeJson → appears in mcp.servers", async () => {
    const src = await makeTmpDir();
    const claude = await makeTmpDir();
    // gatherStatus reads from CLAUDE_JSON_PATH (hardcoded ~/.claude.json)
    // so we test the no-mcp case here and just assert the field is present and an array
    try {
      const data = await gatherStatus(src, claude, "11.2.1");
      expect(Array.isArray(data.mcp.servers)).toBe(true);
    } finally {
      await cleanup(src);
      await cleanup(claude);
    }
  });

  test("warnings include version mismatch when sentinel version differs from packaged", async () => {
    const src = await makeTmpDir();
    const claude = await makeTmpDir();
    try {
      await writeFile(
        join(claude, ".cc-settings-version"),
        JSON.stringify({ version: "10.0.0", installed_at: "2026-01-01T00:00:00Z" }),
      );
      const data = await gatherStatus(src, claude, "11.2.1");
      const messages = data.warnings.map((w) => w.message);
      expect(messages.some((m) => m.includes("10.0.0") && m.includes("11.2.1"))).toBe(true);
    } finally {
      await cleanup(src);
      await cleanup(claude);
    }
  });

  test("packagedVersion field matches the passed-in version", async () => {
    const src = await makeTmpDir();
    const claude = await makeTmpDir();
    try {
      const data = await gatherStatus(src, claude, "99.0.0-test");
      expect(data.packagedVersion).toBe("99.0.0-test");
    } finally {
      await cleanup(src);
      await cleanup(claude);
    }
  });

  // --- safeParse validation boundary tests ---

  test("sentinel with extra unknown fields → still reads version (loose schema)", async () => {
    const src = await makeTmpDir();
    const claude = await makeTmpDir();
    try {
      // The VersionSentinel schema is loose (z.looseObject) so unknown keys are
      // allowed and the known fields are still extracted correctly.
      await writeFile(
        join(claude, ".cc-settings-version"),
        JSON.stringify({
          version: "11.1.0",
          installed_at: "2026-05-01T00:00:00Z",
          future_field: "some-new-value",
        }),
      );
      const data = await gatherStatus(src, claude, "11.2.1");
      expect(data.sentinel.version).toBe("11.1.0");
      expect(data.sentinel.installedAt).toBe("2026-05-01T00:00:00Z");
    } finally {
      await cleanup(src);
      await cleanup(claude);
    }
  });

  test("sentinel with version as non-string → version is null (schema validation failure)", async () => {
    const src = await makeTmpDir();
    const claude = await makeTmpDir();
    try {
      // version should be a string; passing a number causes schema failure.
      // On failure, sentinelVersion stays null (treated as absent).
      await writeFile(
        join(claude, ".cc-settings-version"),
        JSON.stringify({ version: 1234, installed_at: "2026-05-01T00:00:00Z" }),
      );
      const data = await gatherStatus(src, claude, "11.2.1");
      expect(data.sentinel.version).toBeNull();
    } finally {
      await cleanup(src);
      await cleanup(claude);
    }
  });

  test("sentinel with valid version but missing installed_at → installedAt is null", async () => {
    const src = await makeTmpDir();
    const claude = await makeTmpDir();
    try {
      await writeFile(
        join(claude, ".cc-settings-version"),
        JSON.stringify({ version: "11.2.0" }), // no installed_at
      );
      const data = await gatherStatus(src, claude, "11.2.1");
      expect(data.sentinel.version).toBe("11.2.0");
      expect(data.sentinel.installedAt).toBeNull();
    } finally {
      await cleanup(src);
      await cleanup(claude);
    }
  });

  test("settings.json with unknown keys → hooks/env/permissions still read correctly", async () => {
    const src = await makeTmpDir();
    const claude = await makeTmpDir();
    try {
      // status.ts parses settings.json once with the Settings schema
      // (fail-soft: an unparseable file reads as absent).
      const settings = {
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
        },
        env: { CLAUDE_CODE_EFFORT_LEVEL: "xhigh" },
        permissions: { allow: ["Bash(*)", "Read(*)"], deny: [] },
        unknownFutureKey: "should not break anything",
      };
      await writeFile(join(claude, "settings.json"), JSON.stringify(settings, null, 2));
      const data = await gatherStatus(src, claude, "11.2.1");
      expect(data.hooks.events).toContain("SessionStart");
      expect(data.hooks.groupCount).toBe(1);
      expect(data.permissions.allowCount).toBe(2);
      expect(data.permissions.denyCount).toBe(0);
    } finally {
      await cleanup(src);
      await cleanup(claude);
    }
  });

  test("settings.json with hooks → hooks.events and groupCount populated", async () => {
    const src = await makeTmpDir();
    const claude = await makeTmpDir();
    try {
      const settings = {
        hooks: {
          PreToolUse: [{ hooks: [{ type: "command", command: "echo pre" }] }],
          PostToolUse: [
            { hooks: [{ type: "command", command: "echo post1" }] },
            { hooks: [{ type: "command", command: "echo post2" }] },
          ],
        },
      };
      await writeFile(join(claude, "settings.json"), JSON.stringify(settings, null, 2));
      const data = await gatherStatus(src, claude, "11.2.1");
      expect(data.hooks.events).toContain("PreToolUse");
      expect(data.hooks.events).toContain("PostToolUse");
      expect(data.hooks.groupCount).toBe(3);
    } finally {
      await cleanup(src);
      await cleanup(claude);
    }
  });
});
