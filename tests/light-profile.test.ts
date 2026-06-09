// Parity guard + transform unit tests for the light profile.
//
// Purpose:
//   1. PARITY GUARD — share-learning skill must exist on disk.
//   2. TRANSFORM UNITS — applyLightProfile() keeps only $schema + statusLine.
//   3. STRIP UNITS — stripManagedSettings() removes cc-settings footprint and
//      preserves genuinely user-authored content.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyLightProfile, LIGHT_SKILLS, stripManagedSettings } from "../src/lib/light-profile.ts";
import { MANAGED_SKILLS } from "../src/lib/managed-skills.ts";

const REPO = resolve(import.meta.dir, "..");

// ---------------------------------------------------------------------------
// 1. PARITY GUARD — disk existence checks
// ---------------------------------------------------------------------------

describe("light-profile parity guard", () => {
  test("LIGHT_SKILLS = ['share-learning'] only", () => {
    expect(LIGHT_SKILLS).toEqual(["share-learning"]);
  });

  test("share-learning folder exists in skills/", () => {
    expect(existsSync(join(REPO, "skills", "share-learning"))).toBe(true);
  });

  test("every LIGHT_SKILLS entry is in MANAGED_SKILLS", () => {
    const managed = new Set(MANAGED_SKILLS);
    for (const skill of LIGHT_SKILLS) {
      expect(managed.has(skill), `${skill} not in MANAGED_SKILLS`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. TRANSFORM UNITS — applyLightProfile()
// ---------------------------------------------------------------------------

describe("applyLightProfile transform", () => {
  const buildFakeSettings = (): Record<string, unknown> => ({
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    env: { CLAUDE_CODE_EFFORT_LEVEL: "xhigh", ENABLE_PROMPT_CACHING_1H: "1" },
    model: "claude-opus-4-8",
    mcpServers: {
      context7: { command: "bunx", args: ["-y", "@upstash/context7-mcp"] },
      tldr: { command: "tldr-mcp", args: ["--project", "."] },
    },
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: 'bun "$HOME/.claude/src/hooks/safety-net.ts"' }],
        },
      ],
    },
    permissions: {
      allow: ["Bash(git *)", "Read(**/*)", "Edit(**/*)", "Write(**/*)", "WebSearch(*)"],
      deny: [],
    },
    statusLine: {
      command: 'bun "$HOME/.claude/src/hooks/statusline.ts"',
      timeout: 5,
    },
  });

  test("does NOT mutate the input", () => {
    const input = buildFakeSettings();
    const inputCopy = JSON.parse(JSON.stringify(input));
    applyLightProfile(input);
    expect(input).toEqual(inputCopy);
  });

  test("output contains only $schema and statusLine", () => {
    const result = applyLightProfile(buildFakeSettings());
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(["$schema", "statusLine"]);
  });

  test("$schema is preserved", () => {
    const result = applyLightProfile(buildFakeSettings());
    expect(result.$schema).toBe("https://json.schemastore.org/claude-code-settings.json");
  });

  test("statusLine is preserved", () => {
    const input = buildFakeSettings();
    const result = applyLightProfile(input);
    expect(result.statusLine).toEqual((input as Record<string, unknown>).statusLine);
  });

  test("env is dropped", () => {
    const result = applyLightProfile(buildFakeSettings());
    expect("env" in result).toBe(false);
  });

  test("mcpServers is dropped", () => {
    const result = applyLightProfile(buildFakeSettings());
    expect("mcpServers" in result).toBe(false);
  });

  test("hooks is dropped", () => {
    const result = applyLightProfile(buildFakeSettings());
    expect("hooks" in result).toBe(false);
  });

  test("permissions is dropped", () => {
    const result = applyLightProfile(buildFakeSettings());
    expect("permissions" in result).toBe(false);
  });

  test("model is dropped", () => {
    const result = applyLightProfile(buildFakeSettings());
    expect("model" in result).toBe(false);
  });

  test("works when $schema absent", () => {
    const input: Record<string, unknown> = {
      statusLine: { command: "bun statusline.ts", timeout: 5 },
      env: { SOME_KEY: "val" },
    };
    const result = applyLightProfile(input);
    expect(Object.keys(result).sort()).toEqual(["statusLine"]);
  });

  test("works when statusLine absent", () => {
    const input: Record<string, unknown> = {
      $schema: "https://example.com/schema.json",
      env: { SOME_KEY: "val" },
    };
    const result = applyLightProfile(input);
    expect(Object.keys(result).sort()).toEqual(["$schema"]);
  });

  test("empty input returns empty output", () => {
    const result = applyLightProfile({});
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 3. STRIP UNITS — stripManagedSettings()
// ---------------------------------------------------------------------------

describe("stripManagedSettings", () => {
  // Synthetic full baseline — mirrors what composeSettings would return.
  const buildFull = (): Record<string, unknown> => ({
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    env: {
      CLAUDE_CODE_EFFORT_LEVEL: "xhigh",
      ENABLE_PROMPT_CACHING_1H: "1",
      ENABLE_TOOL_SEARCH: "1",
    },
    model: "claude-opus-4-8",
    mcpServers: {
      context7: { command: "bunx", args: ["-y", "@upstash/context7-mcp"] },
      tldr: { command: "tldr-mcp", args: ["--project", "."] },
    },
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: 'bun "$HOME/.claude/src/hooks/safety-net.ts"' }],
        },
      ],
      PostToolUse: [
        {
          hooks: [
            {
              type: "command",
              command: 'bun "$HOME/.claude/src/hooks/tool-cadence.ts"',
              timeout: 3,
            },
          ],
        },
      ],
    },
    permissions: {
      allow: ["Bash(git *)", "Read(**/*)", "Edit(**/*)", "Write(**/*)", "WebSearch(*)"],
      deny: [],
    },
    statusLine: {
      command: 'bun "$HOME/.claude/src/hooks/statusline.ts"',
      timeout: 5,
    },
  });

  // A user settings.json that contains BOTH cc-settings entries AND user-only ones.
  const buildUser = (): Record<string, unknown> => ({
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    // cc-settings env vars
    env: {
      CLAUDE_CODE_EFFORT_LEVEL: "xhigh",
      ENABLE_PROMPT_CACHING_1H: "1",
      ENABLE_TOOL_SEARCH: "1",
      // user-only env var
      MY_CUSTOM_VAR: "hello",
    },
    model: "claude-opus-4-8",
    mcpServers: {
      // cc-settings servers
      context7: { command: "bunx", args: ["-y", "@upstash/context7-mcp"] },
      tldr: { command: "tldr-mcp", args: ["--project", "."] },
      // user-only server
      "my-custom-mcp": { command: "my-mcp", args: [] },
    },
    hooks: {
      // cc-settings hook group (exact match)
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: 'bun "$HOME/.claude/src/hooks/safety-net.ts"' }],
        },
        // user-only hook group
        {
          matcher: "Write",
          hooks: [{ type: "command", command: "my-custom-hook --arg" }],
        },
      ],
      PostToolUse: [
        // cc-settings hook group
        {
          hooks: [
            {
              type: "command",
              command: 'bun "$HOME/.claude/src/hooks/tool-cadence.ts"',
              timeout: 3,
            },
          ],
        },
      ],
    },
    permissions: {
      allow: [
        "Bash(git *)",
        "Read(**/*)",
        "Edit(**/*)",
        "Write(**/*)",
        "WebSearch(*)",
        // user-only permission
        "Bash(docker *)",
      ],
      deny: [],
    },
    statusLine: {
      command: 'bun "$HOME/.claude/src/hooks/statusline.ts"',
      timeout: 5,
    },
    // user-only unknown key
    myCustomSetting: "preserved",
  });

  test("does NOT mutate user input", () => {
    const user = buildUser();
    const userCopy = JSON.parse(JSON.stringify(user));
    const full = buildFull();
    stripManagedSettings(user, full);
    expect(user).toEqual(userCopy);
  });

  test("does NOT mutate full input", () => {
    const full = buildFull();
    const fullCopy = JSON.parse(JSON.stringify(full));
    stripManagedSettings(buildUser(), full);
    expect(full).toEqual(fullCopy);
  });

  test("cc-settings env vars are removed", () => {
    const result = stripManagedSettings(buildUser(), buildFull());
    const env = result.env as Record<string, unknown>;
    expect("CLAUDE_CODE_EFFORT_LEVEL" in env).toBe(false);
    expect("ENABLE_PROMPT_CACHING_1H" in env).toBe(false);
    expect("ENABLE_TOOL_SEARCH" in env).toBe(false);
  });

  test("user-only env var is preserved", () => {
    const result = stripManagedSettings(buildUser(), buildFull());
    const env = result.env as Record<string, unknown>;
    expect(env.MY_CUSTOM_VAR).toBe("hello");
  });

  test("cc-settings MCP servers are removed", () => {
    const result = stripManagedSettings(buildUser(), buildFull());
    const mcp = result.mcpServers as Record<string, unknown>;
    expect("context7" in mcp).toBe(false);
    expect("tldr" in mcp).toBe(false);
  });

  test("user-only MCP server is preserved", () => {
    const result = stripManagedSettings(buildUser(), buildFull());
    const mcp = result.mcpServers as Record<string, unknown>;
    expect("my-custom-mcp" in mcp).toBe(true);
  });

  test("cc-settings hook group (exact match) is removed", () => {
    const result = stripManagedSettings(buildUser(), buildFull());
    const hooks = result.hooks as Record<string, unknown[]>;
    // PreToolUse should still exist (has user-only group) but cc-settings group removed
    expect(Array.isArray(hooks.PreToolUse)).toBe(true);
    const commands = (hooks.PreToolUse as Array<{ hooks?: Array<{ command?: string }> }>).flatMap(
      (g) => (g.hooks ?? []).map((h) => h.command ?? ""),
    );
    expect(commands.some((c) => c.includes("safety-net.ts"))).toBe(false);
  });

  test("user-only hook group is preserved", () => {
    const result = stripManagedSettings(buildUser(), buildFull());
    const hooks = result.hooks as Record<string, unknown[]>;
    const commands = (hooks.PreToolUse as Array<{ hooks?: Array<{ command?: string }> }>).flatMap(
      (g) => (g.hooks ?? []).map((h) => h.command ?? ""),
    );
    expect(commands.some((c) => c.includes("my-custom-hook"))).toBe(true);
  });

  test("empty event (all groups cc-managed) is removed", () => {
    const result = stripManagedSettings(buildUser(), buildFull());
    const hooks = result.hooks as Record<string, unknown>;
    // PostToolUse had only the cc-settings group — should be gone
    expect("PostToolUse" in hooks).toBe(false);
  });

  test("cc-settings permission allow entries are removed", () => {
    const result = stripManagedSettings(buildUser(), buildFull());
    const perms = result.permissions as Record<string, unknown[]>;
    const allow = perms.allow as string[];
    expect(allow.includes("Bash(git *)")).toBe(false);
    expect(allow.includes("Read(**/*)")).toBe(false);
  });

  test("user-only permission allow entry is preserved", () => {
    const result = stripManagedSettings(buildUser(), buildFull());
    const perms = result.permissions as Record<string, unknown[]>;
    const allow = perms.allow as string[];
    expect(allow.includes("Bash(docker *)")).toBe(true);
  });

  test("model is removed when it equals full.model", () => {
    const result = stripManagedSettings(buildUser(), buildFull());
    expect("model" in result).toBe(false);
  });

  test("managed top-level keys (sandbox, teammateMode) are removed when equal to full", () => {
    const user = { sandbox: { enabled: true }, teammateMode: "auto", statusLine: { command: "x" } };
    const full = { sandbox: { enabled: true }, teammateMode: "auto", statusLine: { command: "y" } };
    const result = stripManagedSettings(user, full);
    expect("sandbox" in result).toBe(false);
    expect("teammateMode" in result).toBe(false);
    // statusLine is protected from the generic sweep — the light baseline owns it.
    expect("statusLine" in result).toBe(true);
  });

  test("user-diverged top-level scalar is preserved", () => {
    const result = stripManagedSettings({ teammateMode: "off" }, { teammateMode: "auto" });
    expect(result.teammateMode).toBe("off");
  });

  test("user-only top-level key absent from full is preserved", () => {
    const result = stripManagedSettings({ somethingMine: 42 }, { teammateMode: "auto" });
    expect(result.somethingMine).toBe(42);
  });

  test("user-only unknown key (myCustomSetting) is preserved", () => {
    const result = stripManagedSettings(buildUser(), buildFull());
    expect((result as Record<string, unknown>).myCustomSetting).toBe("preserved");
  });

  test("statusLine is left untouched", () => {
    const user = buildUser();
    const result = stripManagedSettings(user, buildFull());
    expect(result.statusLine).toEqual(user.statusLine);
  });

  test("env is dropped entirely when all keys are cc-managed and none user-only", () => {
    const user: Record<string, unknown> = {
      env: { CLAUDE_CODE_EFFORT_LEVEL: "xhigh", ENABLE_PROMPT_CACHING_1H: "1" },
    };
    const full: Record<string, unknown> = {
      env: { CLAUDE_CODE_EFFORT_LEVEL: "xhigh", ENABLE_PROMPT_CACHING_1H: "1" },
    };
    const result = stripManagedSettings(user, full);
    expect("env" in result).toBe(false);
  });

  test("mcpServers dropped entirely when all are cc-managed", () => {
    const user: Record<string, unknown> = {
      mcpServers: {
        context7: { command: "bunx", args: ["-y", "@upstash/context7-mcp"] },
      },
    };
    const full: Record<string, unknown> = {
      mcpServers: {
        context7: { command: "bunx", args: ["-y", "@upstash/context7-mcp"] },
      },
    };
    const result = stripManagedSettings(user, full);
    expect("mcpServers" in result).toBe(false);
  });

  test("hooks with all cc-script commands are stripped even without exact full match", () => {
    // A hook group whose command is a cc-settings script path — should be removed
    // even if it is not an exact JSON match to any full baseline group.
    const user: Record<string, unknown> = {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: "command",
                command: 'bun "$HOME/.claude/src/hooks/some-new-hook.ts"',
              },
            ],
          },
        ],
      },
    };
    const result = stripManagedSettings(user, {});
    expect("hooks" in result).toBe(false);
  });

  test("user env key with different value from full is preserved", () => {
    const user: Record<string, unknown> = {
      env: { CLAUDE_CODE_EFFORT_LEVEL: "max" }, // user overrode to max
    };
    const full: Record<string, unknown> = {
      env: { CLAUDE_CODE_EFFORT_LEVEL: "xhigh" },
    };
    const result = stripManagedSettings(user, full);
    const env = result.env as Record<string, unknown>;
    // Value differs from full → preserve
    expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe("max");
  });
});
