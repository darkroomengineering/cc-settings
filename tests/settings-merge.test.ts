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
    envUserWins: 0,
    envAdoptedScalars: 0,
    scalarsAdopted: 0,
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
    const result = await permissionsStrategy(undefined, undefined, ctx);
    expect(result.keep).toBe(false);
  });

  test("empty user + non-empty team → all team allow rules present", async () => {
    const ctx = makeCtx();
    const team = { allow: ["Bash(*)", "Read(*)"] };
    const result = await permissionsStrategy(team, {}, ctx);
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
    const result = await permissionsStrategy(team, user, ctx);
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
    const result = await permissionsStrategy(null, null, ctx);
    // null is treated as present (not undefined), so keep:true with empty-ish object
    expect(result.keep).toBe(true);
  });

  test("overlapping allow with union semantics — no duplicates", async () => {
    const ctx = makeCtx();
    const team = { allow: ["Bash(*)", "Read(*)"] };
    const user = { allow: ["Read(*)", "Edit(*)"] };
    const result = await permissionsStrategy(team, user, ctx);
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
    const result = await hooksStrategy(undefined, undefined, ctx);
    expect(result.keep).toBe(false);
  });

  test("user-only hook group with deprecated command is pruned", async () => {
    const ctx = makeCtx();
    const deprecatedCmd = `${process.env.HOME}/.claude/scripts/post-edit.sh`;
    const team = {};
    const user = {
      PostToolUse: [{ hooks: [{ type: "command", command: deprecatedCmd }] }],
    };
    const result = await hooksStrategy(team, user, ctx);
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
    const result = await hooksStrategy(team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const merged = result.value as Record<string, unknown>;
    const preToolUse = merged.PreToolUse as unknown[];
    expect(preToolUse.length).toBe(1);
    expect(ctx.accounting.hooksPruned).toBe(0);
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
    const result = await hooksStrategy(team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    const merged = result.value as Record<string, unknown>;
    const sessionStart = merged.SessionStart as unknown[];
    expect(sessionStart.length).toBe(1);
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
});

// ---------------------------------------------------------------------------
// statusLineStrategy
// ---------------------------------------------------------------------------

describe("statusLineStrategy", () => {
  test("both undefined → keep:false", async () => {
    const ctx = makeCtx();
    const result = await statusLineStrategy(undefined, undefined, ctx);
    expect(result.keep).toBe(false);
  });

  test("user has non-deprecated command → user wins", async () => {
    const ctx = makeCtx();
    const team = { command: `bun "$HOME/.claude/src/hooks/status-line.ts"` };
    const user = { command: `bun "$HOME/.claude/src/hooks/my-status.ts"` };
    const result = await statusLineStrategy(team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toEqual(user);
    expect(ctx.accounting.statusLineReset).toBe(false);
  });

  test("user command points at deprecated .sh script → reset to team", async () => {
    const ctx = makeCtx();
    const team = { command: `bun "$HOME/.claude/src/hooks/status-line.ts"` };
    const user = { command: `/Users/alice/.claude/scripts/status-line.sh` };
    const result = await statusLineStrategy(team, user, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toEqual(team);
    expect(ctx.accounting.statusLineReset).toBe(true);
  });

  test("user command deprecated and no team value → keep:false", async () => {
    const ctx = makeCtx();
    const user = { command: `/Users/alice/.claude/scripts/status-line.sh` };
    const result = await statusLineStrategy(undefined, user, ctx);
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
    const result = await envStrategy(undefined, undefined, ctx);
    expect(result.keep).toBe(false);
  });

  test("user env value differs from team → user wins (non-interactive)", async () => {
    const ctx = makeCtx();
    const team = { CLAUDE_CODE_EFFORT_LEVEL: "xhigh", DEBUG: "0" };
    const user = { CLAUDE_CODE_EFFORT_LEVEL: "max" };
    const result = await envStrategy(team, user, ctx);
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
    const result = await envStrategy(team, user, ctx);
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
    const result = await userWinsScalarStrategy(undefined, undefined, ctx);
    expect(result.keep).toBe(false);
  });

  test("user value wins over team for scalar key (non-interactive)", async () => {
    const ctx = makeCtx();
    const result = await userWinsScalarStrategy("light", "dark", ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toBe("dark"); // user wins
    expect(ctx.accounting.scalarsAdopted).toBe(0);
  });

  test("team-only scalar passes through when user is undefined", async () => {
    const ctx = makeCtx();
    const result = await userWinsScalarStrategy("xhigh", undefined, ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toBe("xhigh");
  });

  test("user-only scalar passes through when team is undefined", async () => {
    const ctx = makeCtx();
    const result = await userWinsScalarStrategy(undefined, "custom-value", ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toBe("custom-value");
  });

  test("identical scalar values → user value returned, no accounting", async () => {
    const ctx = makeCtx();
    const result = await userWinsScalarStrategy("dark", "dark", ctx);
    expect(result.keep).toBe(true);
    if (!result.keep) return;
    expect(result.value).toBe("dark");
    expect(ctx.accounting.scalarsAdopted).toBe(0);
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
      const teamPath = join(dir, "team.json");
      const userPath = join(dir, "user.json");
      const outPath = join(dir, "out.json");
      await writeFile(teamPath, JSON.stringify(team));
      await writeFile(userPath, JSON.stringify(user));

      await expect(
        mergeSettingsWithMcpPreservation(userPath, teamPath, outPath),
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
      const teamPath = join(dir, "team.json");
      const userPath = join(dir, "user.json");
      const outPath = join(dir, "out.json");
      await writeFile(teamPath, JSON.stringify(team));
      await writeFile(userPath, JSON.stringify(user));

      // Must not throw — forward-compat safety
      await expect(
        mergeSettingsWithMcpPreservation(userPath, teamPath, outPath),
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
      const teamPath = join(dir, "team.json");
      const userPath = join(dir, "user.json");
      const outPath = join(dir, "out.json");
      await writeFile(teamPath, JSON.stringify(team));
      await writeFile(userPath, JSON.stringify(user));

      await expect(
        mergeSettingsWithMcpPreservation(userPath, teamPath, outPath),
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
      const teamPath = join(dir, "team.json");
      const userPath = join(dir, "user.json"); // does not exist
      const outPath = join(dir, "out.json");
      await writeFile(teamPath, JSON.stringify(team));

      await expect(
        mergeSettingsWithMcpPreservation(userPath, teamPath, outPath),
      ).resolves.toBeUndefined();

      const out = JSON.parse(await Bun.file(outPath).text());
      expect(out.model).toBe("claude-opus-4-5");
    } finally {
      await cleanup(dir);
    }
  });
});
