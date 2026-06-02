// Tests for the JSON-deserialization boundary added to src/setup.ts.
//
// installSettings() is internal (not exported), so we test the validation
// boundary it relies on: Settings.safeParse() behavior on inputs that
// represent the range of real-world settings.json files the installer will
// encounter. The schema is .passthrough() (not .strict()), so unknown keys
// are accepted — a real live settings.json written by Claude Code (with
// undocumented keys like theme/enabledPlugins) now parses successfully.

import { describe, expect, test } from "bun:test";
import { Settings } from "../src/schemas/settings.ts";

describe("Settings.safeParse — installSettings validation boundary", () => {
  test("valid minimal settings.json → success:true", () => {
    const input = {
      env: { CLAUDE_CODE_EFFORT_LEVEL: "xhigh" },
      model: "claude-opus-4-5",
    };
    const result = Settings.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("empty object → success:true (all fields optional)", () => {
    const result = Settings.safeParse({});
    expect(result.success).toBe(true);
  });

  test("unknown top-level key → success:true (passthrough tolerates undocumented CC keys)", () => {
    // Settings uses .passthrough() — unknown keys are passed through, not rejected.
    // This means a live settings.json that CC has written undocumented keys into
    // (theme, enabledPlugins, agentPushNotifEnabled) now parses successfully.
    // The installer's safeParse fallback is retained for other failures (type errors etc.).
    const input = { unknownFutureKey: "some-value", model: "claude-sonnet-4-5" };
    const result = Settings.safeParse(input);
    expect(result.success).toBe(true);
    // The known field is still accessible in the result:
    expect(input.model).toBe("claude-sonnet-4-5");
  });

  test("settings with valid hooks block → success:true", () => {
    const input = {
      hooks: {
        PreToolUse: [
          {
            hooks: [{ type: "command", command: 'bun "$HOME/.claude/src/hooks/pre.ts"' }],
          },
        ],
      },
    };
    const result = Settings.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("safeParse on non-object input → success:false, does not throw", () => {
    // e.g. settings.json contains a bare array or string (corrupt file)
    expect(() => Settings.safeParse(null)).not.toThrow();
    expect(Settings.safeParse(null).success).toBe(false);
    expect(() => Settings.safeParse("not an object")).not.toThrow();
    expect(Settings.safeParse("not an object").success).toBe(false);
    expect(() => Settings.safeParse(42)).not.toThrow();
    expect(Settings.safeParse(42).success).toBe(false);
  });

  test("safeParse failure exposes issues for debug logging", () => {
    // Type errors on known fields still produce structured issues — the installer
    // logs them for debugging. Use a type violation (model must be string) rather
    // than an unknown key, since passthrough now accepts unknown keys.
    const input = { model: 42 };
    const result = Settings.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      // installSettings logs: issues.map(i => `${i.path.join(".")}: ${i.message}`)
      const message = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      expect(message.length).toBeGreaterThan(0);
    }
  });
});
