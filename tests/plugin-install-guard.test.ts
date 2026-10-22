// The plugin install step reaches the real Claude plugin store and the
// network. It must never run from a test sandbox (HOME under the OS temp
// dir) without every spawn site having to opt out.
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decidePluginCommands,
  FAST_JEV_PLUGIN_ID,
  type ParsedMarketplaceEntry,
  type ParsedPluginEntry,
  pluginInstallAllowed,
  UPSTREAM_PINNED_SHA,
} from "../src/lib/claude-install-settings.ts";

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

// decidePluginCommands ways this could fail, checked one per test below:
//   1. registered marketplace re-added — a `marketplace add` for a repo
//      already in `claude plugin marketplace list --json` must be skipped.
//   2. stale plugin wrongly skipped — an installed plugin whose version
//      differs from what the marketplace now offers must still run.
//   3. disabled plugin skipped — an installed-but-disabled plugin must not
//      be treated as "already current"; it must still run.
//   4. key-bearing install skipped — fast-jev-compaction with storeKey=true
//      (a freshly supplied API key riding the command) must never be
//      skipped, even if it's already installed, enabled, and pinned.
//   5. list failure skips anything — if either `claude plugin ... list`
//      call failed to parse (represented here as null), every command must
//      run and nothing may be marked skipped.
//   6. pinned-SHA mismatch skipped — fast-jev-compaction must not be
//      skipped when the marketplace clone's HEAD isn't UPSTREAM_PINNED_SHA.
//   7. stale plugin reinstalled instead of updated — `plugin install` is a
//      no-op on an installed plugin, so a stale enabled one needs `update`.
describe("decidePluginCommands", () => {
  const marketplaceAddCcSettings = [
    "plugin",
    "marketplace",
    "add",
    "darkroomengineering/cc-settings",
  ] as const;
  const marketplaceAddFastJev = [
    "plugin",
    "marketplace",
    "add",
    "tamaratran/fast-jev-compaction",
  ] as const;
  const marketplaceUpdate = ["plugin", "marketplace", "update", "cc-settings"] as const;
  const installFastJev = [
    "plugin",
    "install",
    FAST_JEV_PLUGIN_ID,
    "--config",
    "compactAtPercent=100",
  ] as const;
  const installCompactionTrigger = ["plugin", "install", "compaction-trigger@cc-settings"] as const;

  const registeredMarketplaces: ParsedMarketplaceEntry[] = [
    {
      name: "cc-settings",
      repo: "darkroomengineering/cc-settings",
      installLocation: "/home/.claude/plugins/marketplaces/cc-settings",
    },
    {
      name: "fast-jev-compaction",
      repo: "tamaratran/fast-jev-compaction",
      installLocation: "/home/.claude/plugins/marketplaces/fast-jev-compaction",
    },
  ];

  test("1. a marketplace already registered is not re-added", () => {
    const decision = decidePluginCommands(
      [marketplaceAddCcSettings, marketplaceAddFastJev],
      [],
      registeredMarketplaces,
      {},
      false,
      false,
    );
    expect(decision.toRun).toEqual([]);
    expect(decision.skipped).toHaveLength(2);
  });

  test("an unregistered marketplace is still added", () => {
    const decision = decidePluginCommands([marketplaceAddCcSettings], [], [], {}, false, false);
    expect(decision.toRun).toEqual([marketplaceAddCcSettings]);
    expect(decision.skipped).toEqual([]);
  });

  test("marketplace update always runs regardless of registration state", () => {
    const decision = decidePluginCommands(
      [marketplaceUpdate],
      [],
      registeredMarketplaces,
      {},
      false,
      false,
    );
    expect(decision.toRun).toEqual([marketplaceUpdate]);
    expect(decision.skipped).toEqual([]);
  });

  test("2 and 7. a stale installed version is updated, not skipped or reinstalled", () => {
    const installed: ParsedPluginEntry[] = [
      { id: "compaction-trigger@cc-settings", version: "0.2.0", enabled: true },
    ];
    const decision = decidePluginCommands(
      [installCompactionTrigger],
      installed,
      registeredMarketplaces,
      { "compaction-trigger@cc-settings": "0.3.0" },
      false,
      false,
    );
    expect(decision.toRun).toEqual([["plugin", "update", "compaction-trigger@cc-settings"]]);
    expect(decision.skipped).toEqual([]);
  });

  test("a current installed version is skipped", () => {
    const installed: ParsedPluginEntry[] = [
      { id: "compaction-trigger@cc-settings", version: "0.3.0", enabled: true },
    ];
    const decision = decidePluginCommands(
      [installCompactionTrigger],
      installed,
      registeredMarketplaces,
      { "compaction-trigger@cc-settings": "0.3.0" },
      false,
      false,
    );
    expect(decision.toRun).toEqual([]);
    expect(decision.skipped).toHaveLength(1);
  });

  test("3. an installed-but-disabled plugin is not skipped", () => {
    const installed: ParsedPluginEntry[] = [
      { id: "compaction-trigger@cc-settings", version: "0.3.0", enabled: false },
    ];
    const decision = decidePluginCommands(
      [installCompactionTrigger],
      installed,
      registeredMarketplaces,
      { "compaction-trigger@cc-settings": "0.3.0" },
      false,
      false,
    );
    expect(decision.toRun).toEqual([installCompactionTrigger]);
    expect(decision.skipped).toEqual([]);
  });

  test("4. a key-bearing fast-jev install is never skipped", () => {
    const installed: ParsedPluginEntry[] = [{ id: FAST_JEV_PLUGIN_ID, enabled: true }];
    const decision = decidePluginCommands(
      [installFastJev],
      installed,
      registeredMarketplaces,
      {},
      true, // pinnedShaMatch — even a matching pin must not save a key-bearing install
      true, // storeKey
    );
    expect(decision.toRun).toEqual([installFastJev]);
    expect(decision.skipped).toEqual([]);
  });

  test("5. a failed plugin list skips nothing and runs every command", () => {
    const decision = decidePluginCommands(
      [marketplaceAddCcSettings, marketplaceUpdate, installFastJev, installCompactionTrigger],
      null,
      registeredMarketplaces,
      { "compaction-trigger@cc-settings": "0.3.0" },
      true,
      false,
    );
    expect(decision.toRun).toHaveLength(4);
    expect(decision.skipped).toEqual([]);
  });

  test("5. a failed marketplace list skips nothing and runs every command", () => {
    const installed: ParsedPluginEntry[] = [
      { id: "compaction-trigger@cc-settings", version: "0.3.0", enabled: true },
    ];
    const decision = decidePluginCommands(
      [marketplaceAddCcSettings, installCompactionTrigger],
      installed,
      null,
      { "compaction-trigger@cc-settings": "0.3.0" },
      false,
      false,
    );
    expect(decision.toRun).toHaveLength(2);
    expect(decision.skipped).toEqual([]);
  });

  test("6. a pinned-SHA mismatch is not skipped", () => {
    const installed: ParsedPluginEntry[] = [{ id: FAST_JEV_PLUGIN_ID, enabled: true }];
    const decision = decidePluginCommands(
      [installFastJev],
      installed,
      registeredMarketplaces,
      {},
      false, // pinnedShaMatch: clone HEAD !== UPSTREAM_PINNED_SHA
      false,
    );
    expect(decision.toRun).toEqual([installFastJev]);
    expect(decision.skipped).toEqual([]);
  });

  test("6. a matching pinned SHA skips an installed, enabled fast-jev", () => {
    const installed: ParsedPluginEntry[] = [{ id: FAST_JEV_PLUGIN_ID, enabled: true }];
    const decision = decidePluginCommands(
      [installFastJev],
      installed,
      registeredMarketplaces,
      {},
      true,
      false,
    );
    expect(decision.toRun).toEqual([]);
    expect(decision.skipped[0]).toContain(UPSTREAM_PINNED_SHA.slice(0, 7));
  });
});
