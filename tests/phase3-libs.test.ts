// Phase 3 shared-lib unit tests. Covers the non-IO pure helpers plus the
// MCP merge, which is the migration's biggest correctness win (data-loss
// risk — hardened here with coverage for the scenarios the bash version
// burned colleagues on).

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atomicWriteJson,
  findUserOnlyServers,
  installMcpToClaudeJson,
  McpParseError,
  mergeSettingsWithMcpPreservation,
  readJsonOrNull,
  readMcpFromSettings,
} from "../src/lib/mcp.ts";
import { getInstallHint } from "../src/lib/packages.ts";
import { getTimestamp, hasCommand, os } from "../src/lib/platform.ts";
import { getSkillAgents, getSkillPatterns, KNOWN_SKILLS } from "../src/lib/skill-patterns.ts";

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

describe("skill-patterns", () => {
  test("KNOWN_SKILLS is non-empty and has all major skills", () => {
    expect(KNOWN_SKILLS.length).toBeGreaterThan(30);
    for (const name of ["fix", "build", "explore", "review", "ship"]) {
      expect(KNOWN_SKILLS).toContain(name);
    }
  });
  test("getSkillPatterns returns [] for unknown", () => {
    expect(getSkillPatterns("totally-unknown")).toEqual([]);
  });
  test("getSkillPatterns returns the expected patterns for a known skill", () => {
    const patterns = getSkillPatterns("fix");
    expect(patterns).toContain("bug");
    expect(patterns).toContain("fix");
  });
  test("getSkillAgents returns agents array", () => {
    expect(getSkillAgents("orchestrate")).toEqual(["maestro"]);
  });
});

describe("mcp — atomic IO", () => {
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

  test("readJsonOrNull throws McpParseError on bad JSON", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-bad-"));
    try {
      const target = join(sandbox, "bad.json");
      await writeFile(target, "{this is not valid json");
      await expect(readJsonOrNull(target)).rejects.toBeInstanceOf(McpParseError);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

describe("mcp — user-only detection", () => {
  test("findUserOnlyServers returns names in user but not in team", () => {
    const only = findUserOnlyServers(
      { a: { command: "x" }, b: { type: "http", url: "https://example.com" } },
      { a: { command: "y" } },
    );
    expect(only).toEqual(["b"]);
  });
  test("empty user → empty result", () => {
    expect(findUserOnlyServers({}, { a: { command: "y" } })).toEqual([]);
  });
});

describe("mcp — settings.json extraction", () => {
  test("reads mcpServers from a settings file", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-read-"));
    try {
      const settings = join(sandbox, "settings.json");
      await writeFile(
        settings,
        JSON.stringify({
          mcpServers: { myserver: { command: "foo" } },
        }),
      );
      const servers = await readMcpFromSettings(settings);
      expect(Object.keys(servers)).toEqual(["myserver"]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("throws on unparseable settings", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-bad-s-"));
    try {
      const settings = join(sandbox, "settings.json");
      await writeFile(settings, "{broken");
      await expect(readMcpFromSettings(settings)).rejects.toBeInstanceOf(McpParseError);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

describe("mcp — merge + preserve", () => {
  test("preserves user-only servers and writes atomically (non-interactive: preserves by default)", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-merge-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const team = join(sandbox, "team-settings.json");
      const out = join(sandbox, "merged.json");
      await writeFile(
        existing,
        JSON.stringify({
          mcpServers: {
            shared: { command: "user-override" },
            "my-custom-mcp": { command: "foo" },
          },
        }),
      );
      await writeFile(
        team,
        JSON.stringify({
          $schema: "https://json.schemastore.org/claude-code-settings.json",
          mcpServers: {
            shared: { command: "team-shared" },
            context7: { command: "team-context7" },
          },
        }),
      );
      // Non-interactive: default is preserve.
      await mergeSettingsWithMcpPreservation(existing, team, out);
      const merged = JSON.parse(await readFile(out, "utf8"));
      // Team keys are base; user-only MCPs preserved; team wins for shared keys
      // (user's local override of `shared` is lost — spec: team base, user-only extras).
      expect(Object.keys(merged.mcpServers).sort()).toEqual([
        "context7",
        "my-custom-mcp",
        "shared",
      ]);
      expect(merged.mcpServers.shared.command).toBe("team-shared");
      expect(merged.mcpServers["my-custom-mcp"].command).toBe("foo");
      // $schema and other team-root fields survive.
      expect(merged.$schema).toBe("https://json.schemastore.org/claude-code-settings.json");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("CC_WIPE_CUSTOM_MCP=1 drops user-only servers silently", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-wipe-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const team = join(sandbox, "team-settings.json");
      const out = join(sandbox, "merged.json");
      await writeFile(
        existing,
        JSON.stringify({ mcpServers: { "my-custom-mcp": { command: "foo" } } }),
      );
      await writeFile(team, JSON.stringify({ mcpServers: { a: { command: "b" } } }));

      const prev = process.env.CC_WIPE_CUSTOM_MCP;
      process.env.CC_WIPE_CUSTOM_MCP = "1";
      try {
        await mergeSettingsWithMcpPreservation(existing, team, out);
      } finally {
        if (prev === undefined) delete process.env.CC_WIPE_CUSTOM_MCP;
        else process.env.CC_WIPE_CUSTOM_MCP = prev;
      }
      const merged = JSON.parse(await readFile(out, "utf8"));
      expect(Object.keys(merged.mcpServers)).toEqual(["a"]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("bad user settings.json aborts (parse error), never overwrites output", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-bad-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const team = join(sandbox, "team-settings.json");
      const out = join(sandbox, "merged.json");
      await writeFile(existing, "{broken}");
      await writeFile(team, JSON.stringify({ mcpServers: { a: { command: "b" } } }));
      await expect(mergeSettingsWithMcpPreservation(existing, team, out)).rejects.toBeInstanceOf(
        McpParseError,
      );
      const { existsSync } = await import("node:fs");
      expect(existsSync(out)).toBe(false);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("no existing user settings → team written as-is", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-new-"));
    try {
      const existing = join(sandbox, "does-not-exist.json");
      const team = join(sandbox, "team-settings.json");
      const out = join(sandbox, "merged.json");
      await writeFile(team, JSON.stringify({ mcpServers: { a: { command: "b" } } }));
      await mergeSettingsWithMcpPreservation(existing, team, out);
      const merged = JSON.parse(await readFile(out, "utf8"));
      expect(merged).toEqual({ mcpServers: { a: { command: "b" } } });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("idempotent: running twice yields identical content", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-idem-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const team = join(sandbox, "team-settings.json");
      const out = join(sandbox, "merged.json");
      await writeFile(existing, JSON.stringify({ mcpServers: { custom: { command: "c" } } }));
      await writeFile(team, JSON.stringify({ mcpServers: { a: { command: "b" } } }));
      await mergeSettingsWithMcpPreservation(existing, team, out);
      const first = await readFile(out, "utf8");
      // Second run: feed the merged output back as "existing" (what a re-install would see).
      await mergeSettingsWithMcpPreservation(out, team, out);
      const second = await readFile(out, "utf8");
      expect(first).toBe(second);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

describe("mcp — claude.json installer", () => {
  test("installs team MCPs while preserving user-defined ones", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-claude-json-"));
    try {
      const teamSettings = join(sandbox, "team-settings.json");
      await writeFile(
        teamSettings,
        JSON.stringify({
          mcpServers: {
            context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
            tldr: { command: "tldr-mcp", args: ["--project", "."] },
          },
        }),
      );
      const claudeJsonPath = join(sandbox, ".claude.json");
      await writeFile(
        claudeJsonPath,
        JSON.stringify({
          mcpServers: {
            "user-only": { command: "custom" },
            // User's local override of context7 should win.
            context7: { command: "user-override" },
          },
          someUnknownField: 42,
        }),
      );

      await installMcpToClaudeJson(teamSettings, claudeJsonPath);
      const result = JSON.parse(await readFile(claudeJsonPath, "utf8"));
      expect(Object.keys(result.mcpServers).sort()).toEqual(["context7", "tldr", "user-only"]);
      // User override wins for shared key.
      expect(result.mcpServers.context7.command).toBe("user-override");
      // Passthrough field survives.
      expect(result.someUnknownField).toBe(42);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
