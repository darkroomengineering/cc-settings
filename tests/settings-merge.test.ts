// Unit tests for the individual merge strategies in src/lib/settings-merge.ts.
// Each test constructs minimal settings blobs, calls the strategy directly,
// and asserts on the result — no file I/O needed.

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MergeAccounting, MergeOptions, StrategyContext } from "../src/lib/settings-merge.ts";
import {
  DEPRECATED_COMMAND_PATTERNS,
  envStrategy,
  hooksStrategy,
  mergeSettingsWithMcpPreservation,
  permissionsStrategy,
  pruneDeprecatedHooks,
  statusLineStrategy,
  userWinsScalarStrategy,
} from "../src/lib/settings-merge.ts";

function makeCtx(opts: MergeOptions = {}): StrategyContext {
  const accounting: MergeAccounting = {
    permissionsAdded: 0,
    permissionsDeclined: 0,
    permissionsAdoptedScalars: 0,
    hooksAdded: 0,
    hooksDeclined: 0,
    hooksPruned: 0,
    hooksSuperseded: 0,
    envUserWins: 0,
    envAdoptedScalars: 0,
    scalarsAdopted: 0,
    defaultsAdded: 0,
    statusLineReset: false,
  };
  return { opts, accounting };
}

// ---------------------------------------------------------------------------
// permissionsStrategy
// ---------------------------------------------------------------------------

describe("permissionsStrategy", () => {
  test("both undefined → keep:false", async () => {
    const ctx = makeCtx();
    const result = await permissionsStrategy("permissions", undefined, undefined, ctx);
    expect(result.keep).toBe(false);
  });

  test("empty user + non-empty team → all team allow rules present", async () => {
    const ctx = makeCtx();
    const team = { allow: ["Bash(*)", "Read(*)"] };
    const result = await permissionsStrategy("permissions", team, {}, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const merged = result.value as Record<string, unknown>;
    expect(merged.allow).toEqual(["Bash(*)", "Read(*)"]);
    expect(ctx.accounting.permissionsAdded).toBe(0); // no user extras
  });

  test("user-only allow rules are preserved", async () => {
    const ctx = makeCtx();
    const team = { allow: ["Bash(*)"] };
    const user = { allow: ["Bash(*)", "Write(*)", "Edit(*)"] };
    const result = await permissionsStrategy("permissions", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const merged = result.value as Record<string, unknown>;
    const allow = merged.allow as string[];
    expect(allow).toContain("Bash(*)");
    expect(allow).toContain("Write(*)");
    expect(allow).toContain("Edit(*)");
    expect(ctx.accounting.permissionsAdded).toBe(2); // Write and Edit are user-only
  });

  test("null permissions on both sides → keep:false", async () => {
    const ctx = makeCtx();
    // null coerces to {} — no arrays, no fields
    const result = await permissionsStrategy("permissions", null, null, ctx);
    // null is treated as present (not undefined), so keep:true with empty-ish object
    expect(result.keep).toBe(true);
  });

  test("overlapping allow with union semantics — no duplicates", async () => {
    const ctx = makeCtx();
    const team = { allow: ["Bash(*)", "Read(*)"] };
    const user = { allow: ["Read(*)", "Edit(*)"] };
    const result = await permissionsStrategy("permissions", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const allow = (result.value as Record<string, unknown>).allow as string[];
    // Read(*) appears in both; should appear once
    expect(allow.filter((r) => r === "Read(*)").length).toBe(1);
    expect(allow).toContain("Bash(*)");
    expect(allow).toContain("Edit(*)");
  });
});

// ---------------------------------------------------------------------------
// hooksStrategy — including DEPRECATED_COMMAND_PATTERNS prune logic
// ---------------------------------------------------------------------------

describe("hooksStrategy", () => {
  test("both undefined → keep:false", async () => {
    const ctx = makeCtx();
    const result = await hooksStrategy("hooks", undefined, undefined, ctx);
    expect(result.keep).toBe(false);
  });

  test("user-only hook group with deprecated command is pruned", async () => {
    const ctx = makeCtx();
    const deprecatedCmd = `${process.env.HOME}/.claude/scripts/post-edit.sh`;
    const team = {};
    const user = {
      PostToolUse: [{ hooks: [{ type: "command", command: deprecatedCmd }] }],
    };
    const result = await hooksStrategy("hooks", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const merged = result.value as Record<string, unknown>;
    // The deprecated hook group should be pruned — empty or absent event
    const postToolUse = merged.PostToolUse as unknown[];
    expect(postToolUse.length).toBe(0);
    expect(ctx.accounting.hooksPruned).toBe(1);
  });

  test("user-only hook group with valid command is preserved", async () => {
    const ctx = makeCtx();
    const validCmd = `bun "$HOME/.claude/src/hooks/my-hook.ts"`;
    const team = {};
    const user = {
      PreToolUse: [{ hooks: [{ type: "command", command: validCmd }] }],
    };
    const result = await hooksStrategy("hooks", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const merged = result.value as Record<string, unknown>;
    const preToolUse = merged.PreToolUse as unknown[];
    expect(preToolUse.length).toBe(1);
    expect(ctx.accounting.hooksPruned).toBe(0);
    expect(ctx.accounting.hooksAdded).toBe(1);
  });

  test("user copy of a team group with reordered keys is not duplicated", async () => {
    const ctx = makeCtx();
    const team = {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `bun "$HOME/.claude/src/scripts/x.ts"`,
              async: true,
              timeout: 3,
            },
          ],
        },
      ],
    };
    // Same group as Claude Code re-serializes it: trailing fields reordered.
    const user = {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `bun "$HOME/.claude/src/scripts/x.ts"`,
              timeout: 3,
              async: true,
            },
          ],
        },
      ],
    };
    const result = await hooksStrategy("hooks", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const groups = (result.value as Record<string, unknown>).UserPromptSubmit as unknown[];
    expect(groups.length).toBe(1);
    expect(ctx.accounting.hooksAdded).toBe(0);
  });

  test("duplicate user groups collapse to one (heals prior duplication)", async () => {
    const ctx = makeCtx();
    const group = {
      hooks: [
        {
          type: "command",
          command: `bun "$HOME/.claude/src/scripts/x.ts"`,
          timeout: 3,
          async: true,
        },
      ],
    };
    const team = {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `bun "$HOME/.claude/src/scripts/x.ts"`,
              async: true,
              timeout: 3,
            },
          ],
        },
      ],
    };
    // An install that already accumulated 7 copies via the old key-order bug.
    const user = { UserPromptSubmit: [group, group, group, group, group, group, group] };
    const result = await hooksStrategy("hooks", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const groups = (result.value as Record<string, unknown>).UserPromptSubmit as unknown[];
    expect(groups.length).toBe(1);
    expect(ctx.accounting.hooksAdded).toBe(0);
  });

  test("stale variant of a team-managed group is superseded by the team copy", async () => {
    const ctx = makeCtx();
    const team = {
      PreToolUse: [
        {
          matcher: "Bash",
          if: "Bash(git commit*)",
          hooks: [
            { type: "command", command: `bun "$HOME/.claude/src/scripts/pre-commit-tsc.ts"` },
          ],
        },
      ],
    };
    // Old team shape (no `if` filter) lingering from a previous install.
    const user = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            { type: "command", command: `bun "$HOME/.claude/src/scripts/pre-commit-tsc.ts"` },
          ],
        },
      ],
    };
    const result = await hooksStrategy("hooks", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const groups = (result.value as Record<string, unknown>).PreToolUse as Array<
      Record<string, unknown>
    >;
    expect(groups.length).toBe(1);
    expect(groups[0]?.if).toBe("Bash(git commit*)");
    expect(ctx.accounting.hooksSuperseded).toBe(1);
    expect(ctx.accounting.hooksAdded).toBe(0);
  });

  test("user group wiring their own (non-managed) script is never superseded", async () => {
    const ctx = makeCtx();
    const team = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: `bun "$HOME/.claude/src/hooks/safety-net.ts"` }],
        },
      ],
    };
    const user = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: `bun "$HOME/my-scripts/audit.ts"` }],
        },
      ],
    };
    const result = await hooksStrategy("hooks", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const groups = (result.value as Record<string, unknown>).PreToolUse as unknown[];
    expect(groups.length).toBe(2);
    expect(ctx.accounting.hooksSuperseded).toBe(0);
    expect(ctx.accounting.hooksAdded).toBe(1);
  });

  test("team hook groups survive (they're not user-only)", async () => {
    const ctx = makeCtx();
    const team = {
      SessionStart: [
        { hooks: [{ type: "command", command: `bun "$HOME/.claude/src/hooks/start.ts"` }] },
      ],
    };
    const user = {};
    const result = await hooksStrategy("hooks", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const merged = result.value as Record<string, unknown>;
    const sessionStart = merged.SessionStart as unknown[];
    expect(sessionStart.length).toBe(1);
  });

  test("removed managed hook in a shared group is pruned without duplicating the surviving team hook", async () => {
    const ctx = makeCtx();
    const stopSummary = {
      type: "command",
      command: `bun "$HOME/.claude/src/scripts/stop-summary.ts"`,
    };
    const judge = {
      type: "command",
      command: `bun "$HOME/.claude/src/hooks/parallelmax-judge.ts"`,
      timeout: 10,
    };
    // Team now ships only stop-summary on Stop; the user still carries the old
    // pre-v11.5.1 group that bundled stop-summary + the removed judge.
    const team = { Stop: [{ hooks: [stopSummary] }] };
    const user = { Stop: [{ hooks: [stopSummary, judge] }] };
    const result = await hooksStrategy("hooks", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const merged = result.value as Record<string, unknown>;
    const stop = merged.Stop as Array<{ hooks: unknown[] }>;
    // Exactly one group with one hook (stop-summary): judge gone, no duplicate.
    expect(stop.length).toBe(1);
    expect(stop[0]?.hooks.length).toBe(1);
    expect(JSON.stringify(stop)).not.toContain("parallelmax-judge");
    expect(ctx.accounting.hooksPruned).toBe(1);
  });

  test("user-extra PostToolUse group with only parallelmax-nudge/review-queue-nudge is dropped while team tool-cadence survives", async () => {
    const ctx = makeCtx();
    const toolCadence = {
      type: "command",
      command: `bun "$HOME/.claude/src/hooks/tool-cadence.ts"`,
    };
    const nudgeGroup = {
      hooks: [
        {
          type: "command",
          command: `bun "$HOME/.claude/src/hooks/parallelmax-nudge.ts"`,
        },
        {
          type: "command",
          command: `bun "$HOME/.claude/src/hooks/review-queue-nudge.ts"`,
        },
      ],
    };
    // Team ships only tool-cadence; user still carries the old nudge group.
    const team = { PostToolUse: [{ hooks: [toolCadence] }] };
    const user = { PostToolUse: [nudgeGroup] };
    const result = await hooksStrategy("hooks", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const merged = result.value as Record<string, unknown>;
    const postToolUse = merged.PostToolUse as Array<{ hooks: unknown[] }>;
    // Only the team's tool-cadence group remains.
    expect(postToolUse.length).toBe(1);
    expect(JSON.stringify(postToolUse)).not.toContain("parallelmax-nudge");
    expect(JSON.stringify(postToolUse)).not.toContain("review-queue-nudge");
    expect(JSON.stringify(postToolUse)).toContain("tool-cadence");
    expect(ctx.accounting.hooksPruned).toBe(1); // the whole nudge group is dropped (one prune event)
  });

  test("duplicate accumulated copies of the same deprecated group all disappear", async () => {
    const ctx = makeCtx();
    const toolCadence = {
      type: "command",
      command: `bun "$HOME/.claude/src/hooks/tool-cadence.ts"`,
    };
    const nudgeGroup = {
      hooks: [
        {
          type: "command",
          command: `bun "$HOME/.claude/src/hooks/parallelmax-nudge.ts"`,
        },
      ],
    };
    // User has accumulated two copies of the nudge group (multiple upgrades that
    // never pruned it). Team ships only tool-cadence.
    const team = { PostToolUse: [{ hooks: [toolCadence] }] };
    const user = { PostToolUse: [nudgeGroup, nudgeGroup] };
    const result = await hooksStrategy("hooks", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const merged = result.value as Record<string, unknown>;
    const postToolUse = merged.PostToolUse as Array<{ hooks: unknown[] }>;
    // Both duplicates dropped; only team's group survives.
    expect(postToolUse.length).toBe(1);
    expect(JSON.stringify(postToolUse)).not.toContain("parallelmax-nudge");
    // uniqueByKey collapses the duplicates before pruning, so the prune
    // accounting sees the group once.
    expect(ctx.accounting.hooksPruned).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// pruneDeprecatedHooks helper
// ---------------------------------------------------------------------------

describe("pruneDeprecatedHooks", () => {
  test("group with only deprecated hooks → null", () => {
    const deprecatedCmd = `/home/user/.claude/scripts/post-edit.sh`;
    const group = { hooks: [{ type: "command", command: deprecatedCmd }] };
    expect(pruneDeprecatedHooks(group)).toBeNull();
  });

  test("group with no deprecated hooks → same reference", () => {
    const group = { hooks: [{ type: "command", command: `bun "$HOME/.claude/src/hooks/ok.ts"` }] };
    expect(pruneDeprecatedHooks(group)).toBe(group); // same reference
  });

  test("DEPRECATED_COMMAND_PATTERNS matches .sh scripts in .claude/scripts/", () => {
    const badCmd = `/Users/alice/.claude/scripts/post-edit.sh`;
    expect(DEPRECATED_COMMAND_PATTERNS.some((re) => re.test(badCmd))).toBe(true);
  });

  test("DEPRECATED_COMMAND_PATTERNS matches the removed parallelmax-judge hook", () => {
    const badCmd = `bun "$HOME/.claude/src/hooks/parallelmax-judge.ts"`;
    expect(DEPRECATED_COMMAND_PATTERNS.some((re) => re.test(badCmd))).toBe(true);
  });

  test("DEPRECATED_COMMAND_PATTERNS matches parallelmax-nudge.ts (merged into tool-cadence.ts)", () => {
    const badCmd = `bun "$HOME/.claude/src/hooks/parallelmax-nudge.ts"`;
    expect(DEPRECATED_COMMAND_PATTERNS.some((re) => re.test(badCmd))).toBe(true);
  });

  test("DEPRECATED_COMMAND_PATTERNS matches review-queue-nudge.ts (merged into tool-cadence.ts)", () => {
    const badCmd = `bun "$HOME/.claude/src/hooks/review-queue-nudge.ts"`;
    expect(DEPRECATED_COMMAND_PATTERNS.some((re) => re.test(badCmd))).toBe(true);
  });

  test("DEPRECATED_COMMAND_PATTERNS matches track-tldr.ts (dead telemetry removed v11.17.0)", () => {
    const badCmd = `bun "$HOME/.claude/src/hooks/track-tldr.ts"`;
    expect(DEPRECATED_COMMAND_PATTERNS.some((re) => re.test(badCmd))).toBe(true);
  });

  test("DEPRECATED_COMMAND_PATTERNS matches tldr-stats.ts (dead telemetry removed v11.17.0)", () => {
    const badCmd = `bun "$HOME/.claude/src/hooks/tldr-stats.ts"`;
    expect(DEPRECATED_COMMAND_PATTERNS.some((re) => re.test(badCmd))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// statusLineStrategy
// ---------------------------------------------------------------------------

describe("statusLineStrategy", () => {
  test("both undefined → keep:false", async () => {
    const ctx = makeCtx();
    const result = await statusLineStrategy("statusLine", undefined, undefined, ctx);
    expect(result.keep).toBe(false);
  });

  test("user has non-deprecated command → user wins", async () => {
    const ctx = makeCtx();
    const team = { command: `bun "$HOME/.claude/src/hooks/status-line.ts"` };
    const user = { command: `bun "$HOME/.claude/src/hooks/my-status.ts"` };
    const result = await statusLineStrategy("statusLine", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toEqual(user);
    expect(ctx.accounting.statusLineReset).toBe(false);
  });

  test("user command points at deprecated .sh script → reset to team", async () => {
    const ctx = makeCtx();
    const team = { command: `bun "$HOME/.claude/src/hooks/status-line.ts"` };
    const user = { command: `/Users/alice/.claude/scripts/status-line.sh` };
    const result = await statusLineStrategy("statusLine", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toEqual(team);
    expect(ctx.accounting.statusLineReset).toBe(true);
  });

  test("user command deprecated and no team value → keep:false", async () => {
    const ctx = makeCtx();
    const user = { command: `/Users/alice/.claude/scripts/status-line.sh` };
    const result = await statusLineStrategy("statusLine", undefined, user, ctx);
    expect(result.keep).toBe(false);
    expect(ctx.accounting.statusLineReset).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// envStrategy
// ---------------------------------------------------------------------------

describe("envStrategy", () => {
  test("both undefined → keep:false", async () => {
    const ctx = makeCtx();
    const result = await envStrategy("env", undefined, undefined, ctx);
    expect(result.keep).toBe(false);
  });

  test("user env value differs from team → user wins (non-interactive)", async () => {
    const ctx = makeCtx();
    const team = { CLAUDE_CODE_EFFORT_LEVEL: "xhigh", DEBUG: "0" };
    const user = { CLAUDE_CODE_EFFORT_LEVEL: "max" };
    const result = await envStrategy("env", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const merged = result.value as Record<string, unknown>;
    expect(merged.CLAUDE_CODE_EFFORT_LEVEL).toBe("max");
    expect(merged.DEBUG).toBe("0"); // team key, no conflict
    expect(ctx.accounting.envUserWins).toBe(1);
  });

  test("user-only env key is preserved", async () => {
    const ctx = makeCtx();
    const team = { SHARED: "1" };
    const user = { MY_CUSTOM: "hello" };
    const result = await envStrategy("env", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const merged = result.value as Record<string, unknown>;
    expect(merged.MY_CUSTOM).toBe("hello");
    expect(merged.SHARED).toBe("1");
    expect(ctx.accounting.envUserWins).toBe(0); // no conflict — user key is unique
  });
});

// ---------------------------------------------------------------------------
// userWinsScalarStrategy
// ---------------------------------------------------------------------------

describe("userWinsScalarStrategy", () => {
  test("both undefined → keep:false", async () => {
    const ctx = makeCtx();
    const result = await userWinsScalarStrategy("model", undefined, undefined, ctx);
    expect(result.keep).toBe(false);
  });

  test("user value wins over team for scalar key (non-interactive)", async () => {
    const ctx = makeCtx();
    const result = await userWinsScalarStrategy("model", "light", "dark", ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toBe("dark"); // user wins
    expect(ctx.accounting.scalarsAdopted).toBe(0);
  });

  test("team-only scalar passes through when user is undefined", async () => {
    const ctx = makeCtx();
    const result = await userWinsScalarStrategy("model", "xhigh", undefined, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toBe("xhigh");
  });

  test("user-only scalar passes through when team is undefined", async () => {
    const ctx = makeCtx();
    const result = await userWinsScalarStrategy("model", undefined, "custom-value", ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toBe("custom-value");
  });

  test("identical scalar values → user value returned, no accounting", async () => {
    const ctx = makeCtx();
    const result = await userWinsScalarStrategy("model", "dark", "dark", ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toBe("dark");
    expect(ctx.accounting.scalarsAdopted).toBe(0);
  });

  // Deep-merge: a team-only nested sub-key (a new config default from a sync)
  // must land inside a block the user already has, instead of being shadowed by
  // the user's whole block. This is the attribution.sessionUrl (v11.27.0) bug.
  test("team-only nested sub-key lands while user sub-keys are preserved", async () => {
    const ctx = makeCtx();
    const team = { commit: "", pr: "", sessionUrl: false };
    const user = { commit: "", pr: "" };
    const result = await userWinsScalarStrategy("attribution", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toEqual({ commit: "", pr: "", sessionUrl: false });
    expect(ctx.accounting.defaultsAdded).toBe(1);
  });

  test("user-customized nested sub-key wins over team on conflict", async () => {
    const ctx = makeCtx();
    const team = { commit: "", pr: "", sessionUrl: false };
    const user = { commit: "Custom trailer", pr: "", sessionUrl: true };
    const result = await userWinsScalarStrategy("attribution", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    // user's commit + sessionUrl win; no team-only keys to add
    expect(result.value).toEqual({ commit: "Custom trailer", pr: "", sessionUrl: true });
    expect(ctx.accounting.defaultsAdded).toBe(0);
  });

  test("nested objects recurse (defaults land at depth > 1)", async () => {
    const ctx = makeCtx();
    const team = { enabled: true, network: { allowAppleEvents: false, proxy: "team" } };
    const user = { enabled: true, network: { proxy: "user" } };
    const result = await userWinsScalarStrategy("sandbox", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toEqual({
      enabled: true,
      network: { allowAppleEvents: false, proxy: "user" },
    });
    expect(ctx.accounting.defaultsAdded).toBe(1); // network.allowAppleEvents
  });

  test("arrays stay user-wins-whole (no element merge)", async () => {
    const ctx = makeCtx();
    const team = { mode: "replace", verbs: ["A", "B", "C"] };
    const user = { mode: "replace", verbs: ["X"] };
    const result = await userWinsScalarStrategy("spinnerVerbs", team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toEqual({ mode: "replace", verbs: ["X"] });
    expect(ctx.accounting.defaultsAdded).toBe(0);
  });

  test("object↔scalar shape mismatch → user wins (no merge attempt)", async () => {
    const ctx = makeCtx();
    const result = await userWinsScalarStrategy("k", { a: 1 }, "scalar", ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toBe("scalar");
  });
});

// Integration: the merger end-to-end must land a team-only nested default into a
// user's existing block (regression lock for attribution.sessionUrl, v11.27.0).
describe("mergeSettingsWithMcpPreservation — nested defaults", () => {
  test("team attribution.sessionUrl lands into a user block that lacks it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-merge-nested-"));
    try {
      const team = { attribution: { commit: "", pr: "", sessionUrl: false } };
      const user = { attribution: { commit: "", pr: "" } };
      const userPath = join(dir, "user.json");
      const outPath = join(dir, "out.json");
      await writeFile(userPath, JSON.stringify(user));

      await mergeSettingsWithMcpPreservation(userPath, team, outPath);

      const merged = JSON.parse(await Bun.file(outPath).text());
      expect(merged.attribution).toEqual({ commit: "", pr: "", sessionUrl: false });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// mergeSettingsWithMcpPreservation — safeParse validation of userRaw/teamRaw
// ---------------------------------------------------------------------------
//
// These tests verify the forward-compat safety: when userRaw or teamRaw
// contains keys unknown to the Settings schema (e.g. a new Claude Code
// version added a field), the merger logs a debug message and proceeds with
// the raw objects rather than aborting.

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-merge-test-"));
}
async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

describe("mergeSettingsWithMcpPreservation — safeParse validation", () => {
  test("valid user + team settings → merges without error", async () => {
    const dir = await makeTmpDir();
    try {
      const team = { env: { CLAUDE_CODE_EFFORT_LEVEL: "xhigh" }, model: "claude-opus-4-5" };
      const user = { env: { MY_FLAG: "1" }, model: "claude-sonnet-4-5" };
      const userPath = join(dir, "user.json");
      const outPath = join(dir, "out.json");
      await writeFile(userPath, JSON.stringify(user));

      await expect(
        mergeSettingsWithMcpPreservation(userPath, team, outPath),
      ).resolves.toBeUndefined();

      const merged = JSON.parse(await Bun.file(outPath).text());
      // user model wins
      expect(merged.model).toBe("claude-sonnet-4-5");
      // env is unioned (user wins on conflict)
      expect(merged.env.MY_FLAG).toBe("1");
      expect(merged.env.CLAUDE_CODE_EFFORT_LEVEL).toBe("xhigh");
    } finally {
      await cleanup(dir);
    }
  });

  test("userRaw with unknown key (schema validation failure) → merger proceeds, output written", async () => {
    // Simulates a newer Claude Code version adding a settings key not yet in
    // the Settings schema. The safeParse validation logs debug + proceeds.
    const dir = await makeTmpDir();
    try {
      const team = { model: "claude-opus-4-5" };
      // unknownFutureKey is not in the Settings schema (it uses .strict())
      const user = { model: "claude-sonnet-4-5", unknownFutureKey: "value-from-new-cc" };
      const userPath = join(dir, "user.json");
      const outPath = join(dir, "out.json");
      await writeFile(userPath, JSON.stringify(user));

      // Must not throw — forward-compat safety
      await expect(
        mergeSettingsWithMcpPreservation(userPath, team, outPath),
      ).resolves.toBeUndefined();

      // The unknown key should be preserved in the output (user wins via
      // userWinsScalarStrategy fallback)
      const merged = JSON.parse(await Bun.file(outPath).text());
      expect(merged.unknownFutureKey).toBe("value-from-new-cc");
    } finally {
      await cleanup(dir);
    }
  });

  test("teamRaw with unknown key → merger proceeds, output written", async () => {
    const dir = await makeTmpDir();
    try {
      const team = { model: "claude-opus-4-5", teamNewFeature: "enabled" };
      const user = { model: "claude-sonnet-4-5" };
      const userPath = join(dir, "user.json");
      const outPath = join(dir, "out.json");
      await writeFile(userPath, JSON.stringify(user));

      await expect(
        mergeSettingsWithMcpPreservation(userPath, team, outPath),
      ).resolves.toBeUndefined();

      // teamNewFeature should be present (user has no value → team wins)
      const merged = JSON.parse(await Bun.file(outPath).text());
      expect(merged.teamNewFeature).toBe("enabled");
    } finally {
      await cleanup(dir);
    }
  });

  test("missing user settings file → writes team settings as-is", async () => {
    const dir = await makeTmpDir();
    try {
      const team = { model: "claude-opus-4-5", env: { CLAUDE_CODE_EFFORT_LEVEL: "xhigh" } };
      const userPath = join(dir, "user.json"); // does not exist
      const outPath = join(dir, "out.json");

      await expect(
        mergeSettingsWithMcpPreservation(userPath, team, outPath),
      ).resolves.toBeUndefined();

      const out = JSON.parse(await Bun.file(outPath).text());
      expect(out.model).toBe("claude-opus-4-5");
    } finally {
      await cleanup(dir);
    }
  });
});
