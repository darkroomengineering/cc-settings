// The plugin install step reaches the real Claude plugin store and the
// network. It must never run from a test sandbox (HOME under the OS temp
// dir) without every spawn site having to opt out.
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginInstallAllowed } from "../src/lib/claude-install-settings.ts";

describe("pluginInstallAllowed", () => {
  test("runs for a real install: HOME outside the temp dir", () => {
    expect(pluginInstallAllowed({}, "/Users/dev", "/tmp")).toBe(true);
    expect(pluginInstallAllowed({}, "/Users/dev/", "/tmp/")).toBe(true);
  });

  test("skips a HOME under the temp dir, including a real mkdtemp sandbox", async () => {
    expect(pluginInstallAllowed({}, "/tmp/cc-e2e-abc/home", "/tmp")).toBe(false);
    expect(pluginInstallAllowed({}, "/tmp", "/tmp")).toBe(false);
    const sandbox = await mkdtemp(join(tmpdir(), "cc-guard-"));
    try {
      expect(pluginInstallAllowed({}, sandbox)).toBe(false);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("a sibling path that only shares a prefix is not inside the temp dir", () => {
    expect(pluginInstallAllowed({}, "/tmpfs/home", "/tmp")).toBe(true);
  });

  test("skip flag wins over everything", () => {
    expect(
      pluginInstallAllowed(
        { CC_SETTINGS_SKIP_PLUGIN_INSTALL: "1", CC_SETTINGS_FORCE_PLUGIN_INSTALL: "1" },
        "/Users/dev",
        "/tmp",
      ),
    ).toBe(false);
  });

  test("force flag runs the step from a sandbox", () => {
    expect(pluginInstallAllowed({ CC_SETTINGS_FORCE_PLUGIN_INSTALL: "1" }, "/tmp/x", "/tmp")).toBe(
      true,
    );
  });
});
