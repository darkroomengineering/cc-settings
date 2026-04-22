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

  test("preserves user-added permission rules (allow/deny/ask) via union", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-perms-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const team = join(sandbox, "team-settings.json");
      const out = join(sandbox, "merged.json");
      await writeFile(
        existing,
        JSON.stringify({
          permissions: {
            allow: ["Bash(bun:*)", "Bash(docker:*)", "Bash(kubectl:*)"],
            deny: ["Bash(rm -rf /)", "Bash(sudo:*)"],
            ask: ["Bash(curl:*)"],
            defaultMode: "acceptEdits",
          },
        }),
      );
      await writeFile(
        team,
        JSON.stringify({
          permissions: {
            allow: ["Bash(bun:*)", "Bash(git:*)"],
            deny: ["Bash(rm -rf /)"],
            defaultMode: "default",
          },
        }),
      );
      await mergeSettingsWithMcpPreservation(existing, team, out);
      const merged = JSON.parse(await readFile(out, "utf8"));
      // Union: team baseline + user extras, no dupes.
      expect(merged.permissions.allow).toEqual([
        "Bash(bun:*)",
        "Bash(git:*)",
        "Bash(docker:*)",
        "Bash(kubectl:*)",
      ]);
      // Team deny entries are never lost.
      expect(merged.permissions.deny).toEqual(["Bash(rm -rf /)", "Bash(sudo:*)"]);
      // User-only array surfaces.
      expect(merged.permissions.ask).toEqual(["Bash(curl:*)"]);
      // Scalar: user wins when declared.
      expect(merged.permissions.defaultMode).toBe("acceptEdits");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("team deny rules re-appear even if user removed them", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-deny-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const team = join(sandbox, "team-settings.json");
      const out = join(sandbox, "merged.json");
      // User has deleted all team denies locally.
      await writeFile(existing, JSON.stringify({ permissions: { deny: [] } }));
      await writeFile(
        team,
        JSON.stringify({
          permissions: { deny: ["Bash(rm -rf /)", "Bash(rm -rf ~)"] },
        }),
      );
      await mergeSettingsWithMcpPreservation(existing, team, out);
      const merged = JSON.parse(await readFile(out, "utf8"));
      expect(merged.permissions.deny).toEqual(["Bash(rm -rf /)", "Bash(rm -rf ~)"]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("preserves user hook groups per event while keeping team hooks", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-hooks-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const team = join(sandbox, "team-settings.json");
      const out = join(sandbox, "merged.json");
      const teamHook = { hooks: [{ type: "command", command: "team-hook" }] };
      const userHook = { hooks: [{ type: "command", command: "user-hook" }] };
      const userStopHook = { hooks: [{ type: "command", command: "user-stop" }] };
      await writeFile(
        existing,
        JSON.stringify({
          hooks: {
            PreToolUse: [teamHook, userHook], // one dup, one new
            Stop: [userStopHook],
          },
        }),
      );
      await writeFile(team, JSON.stringify({ hooks: { PreToolUse: [teamHook] } }));
      await mergeSettingsWithMcpPreservation(existing, team, out);
      const merged = JSON.parse(await readFile(out, "utf8"));
      // Team hook kept, user's new group appended, no dupes.
      expect(merged.hooks.PreToolUse).toEqual([teamHook, userHook]);
      // User-only event surfaces.
      expect(merged.hooks.Stop).toEqual([userStopHook]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("env user values win on conflict, team fills in missing", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-env-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const team = join(sandbox, "team-settings.json");
      const out = join(sandbox, "merged.json");
      await writeFile(
        existing,
        JSON.stringify({
          env: { ENABLE_PROMPT_CACHING_1H: "0", USER_ONLY: "yes" },
        }),
      );
      await writeFile(
        team,
        JSON.stringify({
          env: { ENABLE_PROMPT_CACHING_1H: "1", TEAM_ONLY: "yes" },
        }),
      );
      await mergeSettingsWithMcpPreservation(existing, team, out);
      const merged = JSON.parse(await readFile(out, "utf8"));
      expect(merged.env.ENABLE_PROMPT_CACHING_1H).toBe("0"); // user wins
      expect(merged.env.USER_ONLY).toBe("yes");
      expect(merged.env.TEAM_ONLY).toBe("yes"); // team fills gap
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("interactive mode with default prompts matches non-interactive output", async () => {
    // In a non-TTY test env, `promptYn` returns its default. Merge defaults
    // are "adopt team additions" and "keep user's value" — both of which
    // match the non-interactive auto-merge semantics. So interactive+defaults
    // should produce byte-identical output to plain merge (guards against
    // accidental divergence of the two code paths).
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-interactive-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const team = join(sandbox, "team-settings.json");
      const autoOut = join(sandbox, "auto.json");
      const interactiveOut = join(sandbox, "interactive.json");
      await writeFile(
        existing,
        JSON.stringify({
          model: "opus[1m]",
          permissions: {
            allow: ["Bash(bun:*)", "Bash(docker:*)"],
            deny: ["Bash(sudo:*)"],
          },
          env: { DEBUG: "1", LOCAL_ONLY: "yes" },
        }),
      );
      await writeFile(
        team,
        JSON.stringify({
          model: "sonnet",
          statusLine: "team-bar",
          permissions: {
            allow: ["Bash(bun:*)", "Bash(git:*)"],
            deny: ["Bash(rm -rf /)"],
          },
          env: { DEBUG: "0", TEAM_ONLY: "yes" },
        }),
      );
      await mergeSettingsWithMcpPreservation(existing, team, autoOut);
      await mergeSettingsWithMcpPreservation(existing, team, interactiveOut, { interactive: true });
      expect(await readFile(interactiveOut, "utf8")).toBe(await readFile(autoOut, "utf8"));
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("interactive mode: deny rules always auto-apply (guardrail, never prompted)", async () => {
    // Even if user declined every prompt, deny additions must still land.
    // We can't easily mock "decline all" in a non-TTY test, so this asserts
    // via the observed output that new team deny rules merged through.
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-deny-interactive-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const team = join(sandbox, "team-settings.json");
      const out = join(sandbox, "merged.json");
      await writeFile(existing, JSON.stringify({ permissions: { deny: [] } }));
      await writeFile(
        team,
        JSON.stringify({
          permissions: { deny: ["Bash(rm -rf /)", "Bash(sudo:*)"] },
        }),
      );
      await mergeSettingsWithMcpPreservation(existing, team, out, { interactive: true });
      const merged = JSON.parse(await readFile(out, "utf8"));
      expect(merged.permissions.deny).toEqual(["Bash(rm -rf /)", "Bash(sudo:*)"]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("top-level scalars: user wins when declared", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-scalar-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const team = join(sandbox, "team-settings.json");
      const out = join(sandbox, "merged.json");
      await writeFile(existing, JSON.stringify({ model: "opus[1m]", theme: "dark" }));
      await writeFile(team, JSON.stringify({ model: "sonnet", statusLine: "team" }));
      await mergeSettingsWithMcpPreservation(existing, team, out);
      const merged = JSON.parse(await readFile(out, "utf8"));
      expect(merged.model).toBe("opus[1m]"); // user wins
      expect(merged.theme).toBe("dark"); // user-only
      expect(merged.statusLine).toBe("team"); // team fills gap
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
