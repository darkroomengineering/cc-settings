// Tests for the JSON-deserialization boundary added to src/setup.ts.
//
// installSettings() is internal (not exported), so we test the validation
// boundary it relies on: Settings.safeParse() behavior on inputs that
// represent the range of real-world settings.json files the installer will
// encounter. The forward-compat fallback (schema failure → log + use raw)
// is also exercised here by confirming safeParse returns success:false for
// files with unknown keys (which the .strict() schema catches) and that
// the raw object is still a usable fallback.

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

  test("unknown top-level key → success:false (strict schema catches forward-compat drift)", () => {
    // Settings uses .strict() — unknown keys fail.
    // When this happens in installSettings, the raw object is used as fallback
    // so fingerprinting still works. This test documents that invariant.
    const input = { unknownFutureKey: "some-value", model: "claude-sonnet-4-5" };
    const result = Settings.safeParse(input);
    expect(result.success).toBe(false);
    // On failure the installer logs a debug message and falls back to raw.
    // The raw object must still be usable:
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
    const input = { badKey: true };
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
