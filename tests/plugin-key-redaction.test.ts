// The TypeSafe key passes through the plugin install step as a CLI argument;
// every line that could print that argument (dry-run, warnings) goes through
// redactKey first, so the key never reaches a log or the terminal.
import { describe, expect, test } from "bun:test";
import { LATER_KEY_COMMAND, redactKey } from "../src/lib/claude-install-settings.ts";

describe("redactKey", () => {
  test("replaces every occurrence of the key", () => {
    expect(redactKey("claude plugin install x --config apiKey=s3cret and s3cret", "s3cret")).toBe(
      "claude plugin install x --config apiKey=<redacted> and <redacted>",
    );
  });

  test("passes text through when there is no key", () => {
    expect(redactKey("nothing here", null)).toBe("nothing here");
    expect(redactKey("nothing here", undefined)).toBe("nothing here");
    expect(redactKey("nothing here", "")).toBe("nothing here");
  });

  test("the later-install hint never carries a real key", () => {
    expect(LATER_KEY_COMMAND).toContain("apiKey=<key>");
  });
});
