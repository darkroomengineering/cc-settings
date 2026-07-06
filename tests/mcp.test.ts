// MCP merge integration suites: user-only detection, merge + preserve,
// and the ~/.claude.json installer.

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonParseError } from "../src/lib/json-io.ts";
import {
  findUserOnlyServers,
  installMcpToClaudeJson,
  mergeSettingsWithMcpPreservation,
  resolveMcpServers,
} from "../src/lib/mcp.ts";
import { McpServer } from "../src/schemas/mcp.ts";

describe("McpServer schema — cross-shape guard (issue #83)", () => {
  test("rejects an entry mixing stdio `command` with http/sse `url`", () => {
    // Repro: a plausible stdio→http migration typo. Before the guard this
    // parsed successfully as stdio-only, silently dropping `url`.
    const r = McpServer.safeParse({ command: "foo", url: "https://x" });
    expect(r.success).toBe(false);
  });

  test("still accepts a valid stdio-only entry", () => {
    const r = McpServer.safeParse({ command: "foo", args: ["--flag"] });
    expect(r.success).toBe(true);
  });

  test("still accepts a valid http-only entry", () => {
    const r = McpServer.safeParse({ type: "http", url: "https://example.com" });
    expect(r.success).toBe(true);
  });

  test("still accepts a valid sse-only entry", () => {
    const r = McpServer.safeParse({ type: "sse", url: "https://example.com/sse" });
    expect(r.success).toBe(true);
  });

  test("rejects an entry mixing `command` with `headers`", () => {
    const r = McpServer.safeParse({ command: "foo", headers: { Authorization: "x" } });
    expect(r.success).toBe(false);
  });

  test("still accepts benign unknown fields alongside a valid shape (forward-compat)", () => {
    // Documentation-only fields already modeled (mcpCommentary) plus a
    // hypothetical future field should NOT be rejected by the cross-shape
    // guard — only actual stdio/network key conflicts are rejected.
    const r = McpServer.safeParse({ command: "foo", _description: "docs", alwaysLoad: true });
    expect(r.success).toBe(true);
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

describe("mcp — resolveMcpServers precedence for shared server names", () => {
  test("Issue #78 regression: divergent user definition of a team-known server wins", async () => {
    // Both configs define `context7`, but the user has customized it (e.g.
    // tweaked env/args). Before the fix, resolveMcpServers computed
    // `{ ...teamServers, ...preserved }` where `preserved` only ever contains
    // user-ONLY servers (findUserOnlyServers excludes anything present in
    // teamServers) — so a same-named server's user customization was silently
    // dropped in favor of the team value, inconsistent with
    // installMcpToClaudeJson's documented user-wins precedence.
    const userServers = {
      context7: {
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        env: { API_KEY: "user-key" },
      },
    };
    const teamServers = {
      context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
    };
    const resolved = await resolveMcpServers(userServers, teamServers);
    expect(resolved.context7).toEqual(userServers.context7);
    expect(resolved.context7).not.toEqual(teamServers.context7);
  });

  test("identical shared definitions take the team value (no divergence, no noise)", async () => {
    const shared = { command: "npx", args: ["-y", "@upstash/context7-mcp"] };
    const userServers = { context7: { ...shared } };
    const teamServers = { context7: { ...shared } };
    const resolved = await resolveMcpServers(userServers, teamServers);
    expect(resolved.context7).toEqual(teamServers.context7);
  });

  test("key-order-only differences count as identical (canonical compare)", async () => {
    const userServers = { context7: { args: ["-y"], command: "npx" } };
    const teamServers = { context7: { command: "npx", args: ["-y"] } };
    const resolved = await resolveMcpServers(userServers, teamServers);
    expect(resolved.context7).toEqual(teamServers.context7);
  });
});

describe("mcp — merge + preserve", () => {
  test("preserves user-only servers and writes atomically (non-interactive: preserves by default)", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-merge-"));
    try {
      const existing = join(sandbox, "user-settings.json");
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
      const team = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        mcpServers: {
          shared: { command: "team-shared" },
          context7: { command: "team-context7" },
        },
      };
      // Non-interactive: default is preserve.
      await mergeSettingsWithMcpPreservation(existing, team, out);
      const merged = JSON.parse(await readFile(out, "utf8"));
      // Team keys are base; user-only MCPs preserved; user's customization of
      // a shared server name wins over the team definition (user-wins
      // precedence, consistent with installMcpToClaudeJson).
      expect(Object.keys(merged.mcpServers).sort()).toEqual([
        "context7",
        "my-custom-mcp",
        "shared",
      ]);
      expect(merged.mcpServers.shared.command).toBe("user-override");
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
      const out = join(sandbox, "merged.json");
      await writeFile(
        existing,
        JSON.stringify({ mcpServers: { "my-custom-mcp": { command: "foo" } } }),
      );
      const team = { mcpServers: { a: { command: "b" } } };

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
      const out = join(sandbox, "merged.json");
      await writeFile(existing, "{broken}");
      const team = { mcpServers: { a: { command: "b" } } };
      await expect(mergeSettingsWithMcpPreservation(existing, team, out)).rejects.toBeInstanceOf(
        JsonParseError,
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
      const out = join(sandbox, "merged.json");
      const team = { mcpServers: { a: { command: "b" } } };
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
      const out = join(sandbox, "merged.json");
      await writeFile(existing, JSON.stringify({ mcpServers: { custom: { command: "c" } } }));
      const team = { mcpServers: { a: { command: "b" } } };
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
      const team = {
        permissions: {
          allow: ["Bash(bun:*)", "Bash(git:*)"],
          deny: ["Bash(rm -rf /)"],
          defaultMode: "default",
        },
      };
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
      const out = join(sandbox, "merged.json");
      // User has deleted all team denies locally.
      await writeFile(existing, JSON.stringify({ permissions: { deny: [] } }));
      const team = {
        permissions: { deny: ["Bash(rm -rf /)", "Bash(rm -rf ~)"] },
      };
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
      const team = { hooks: { PreToolUse: [teamHook] } };
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

  test("resets stale statusLine command pointing at removed ~/.claude/scripts/*.sh", async () => {
    // Regression: pre-v10 cc-settings shipped statusLine as bash
    // "$HOME/.claude/scripts/statusline.sh". Bash → TS migration replaced
    // it with bun "$HOME/.claude/src/hooks/statusline.ts". Without explicit
    // detection the merger preserves the user's stale object via the
    // { ...teamRaw, ...userRaw } spread, so the bar silently fails to render.
    // See CHANGELOG v10.4.1.
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-statusline-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const out = join(sandbox, "merged.json");

      await writeFile(
        existing,
        JSON.stringify({
          statusLine: {
            type: "command",
            command: 'bash "$HOME/.claude/scripts/statusline.sh"',
          },
        }),
      );
      const team = {
        statusLine: {
          type: "command",
          command: 'bun "$HOME/.claude/src/hooks/statusline.ts"',
          refreshInterval: 30,
        },
      };
      await mergeSettingsWithMcpPreservation(existing, team, out);
      const merged = JSON.parse(await readFile(out, "utf8"));
      expect(merged.statusLine.command).toBe('bun "$HOME/.claude/src/hooks/statusline.ts"');
      expect(merged.statusLine.refreshInterval).toBe(30);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("preserves user-customized statusLine pointing at a non-deprecated path", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-statusline-keep-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const out = join(sandbox, "merged.json");

      // User's statusLine points at their own custom script (not a removed
      // cc-settings path). Should survive intact.
      await writeFile(
        existing,
        JSON.stringify({
          statusLine: {
            type: "command",
            command: 'node "$HOME/scripts/my-status.js"',
          },
        }),
      );
      const team = {
        statusLine: {
          type: "command",
          command: 'bun "$HOME/.claude/src/hooks/statusline.ts"',
        },
      };
      await mergeSettingsWithMcpPreservation(existing, team, out);
      const merged = JSON.parse(await readFile(out, "utf8"));
      expect(merged.statusLine.command).toBe('node "$HOME/scripts/my-status.js"');
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("prunes user hooks pointing at removed ~/.claude/scripts/*.sh files", async () => {
    // Regression: pre-v10.0 cc-settings shipped bash hooks under
    // ~/.claude/scripts/. The bash → TS migration removed that directory.
    // Without prune logic, the per-event hook union preserved the dangling
    // user references forever, producing "No such file or directory" on every
    // session. See CHANGELOG v10.3.2.
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-stale-hooks-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const out = join(sandbox, "merged.json");

      // User has the broken bash refs (entire group + a partial group with a
      // legitimate sibling) plus a legitimate hook that should survive.
      const staleStop = {
        hooks: [{ type: "command", command: "bash $HOME/.claude/scripts/compact-reminder.sh" }],
      };
      const stalePre = {
        hooks: [
          {
            type: "command",
            command: 'bash "$HOME/.claude/scripts/check-docs-before-install.sh"',
          },
          { type: "command", command: "echo legitimate-sibling" },
        ],
      };
      const userKeep = { hooks: [{ type: "command", command: "user-custom-hook" }] };
      const teamPre = {
        hooks: [
          {
            type: "command",
            command: 'bun "$HOME/.claude/src/scripts/check-docs-before-install.ts"',
          },
        ],
      };

      await writeFile(
        existing,
        JSON.stringify({
          hooks: {
            Stop: [staleStop],
            PreToolUse: [stalePre, userKeep],
          },
        }),
      );
      const team = { hooks: { PreToolUse: [teamPre] } };
      await mergeSettingsWithMcpPreservation(existing, team, out);
      const merged = JSON.parse(await readFile(out, "utf8"));

      // Stop event: only entry was the stale reference → event becomes empty.
      expect(merged.hooks.Stop).toEqual([]);

      // PreToolUse: team entry survives, stalePre's sibling hook survives in
      // a partially-pruned group, fully-legitimate userKeep survives.
      expect(merged.hooks.PreToolUse).toEqual([
        teamPre,
        { hooks: [{ type: "command", command: "echo legitimate-sibling" }] },
        userKeep,
      ]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("unknown top-level keys pass through to merged output (strategy-table fallback)", async () => {
    // Locks in the userWinsScalarStrategy fallback. A field cc-settings
    // doesn't know about (e.g. some new Claude Code key) should round-trip
    // without being dropped.
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-fallback-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const out = join(sandbox, "merged.json");
      await writeFile(existing, JSON.stringify({ futureField: "user-side" }));
      const team = { teamOnlyField: "team-side", model: "opus" };
      await mergeSettingsWithMcpPreservation(existing, team, out);
      const merged = JSON.parse(await readFile(out, "utf8"));
      expect(merged.futureField).toBe("user-side"); // user-only survives
      expect(merged.teamOnlyField).toBe("team-side"); // team-only survives
      expect(merged.model).toBe("opus"); // team value (no user override)
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("env user values win on conflict, team fills in missing", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-env-"));
    try {
      const existing = join(sandbox, "user-settings.json");
      const out = join(sandbox, "merged.json");
      await writeFile(
        existing,
        JSON.stringify({
          env: { ENABLE_PROMPT_CACHING_1H: "0", USER_ONLY: "yes" },
        }),
      );
      const team = {
        env: { ENABLE_PROMPT_CACHING_1H: "1", TEAM_ONLY: "yes" },
      };
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
      const team = {
        model: "sonnet",
        statusLine: "team-bar",
        permissions: {
          allow: ["Bash(bun:*)", "Bash(git:*)"],
          deny: ["Bash(rm -rf /)"],
        },
        env: { DEBUG: "0", TEAM_ONLY: "yes" },
      };
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
      const out = join(sandbox, "merged.json");
      await writeFile(existing, JSON.stringify({ permissions: { deny: [] } }));
      const team = {
        permissions: { deny: ["Bash(rm -rf /)", "Bash(sudo:*)"] },
      };
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
      const out = join(sandbox, "merged.json");
      await writeFile(existing, JSON.stringify({ model: "opus[1m]", theme: "dark" }));
      const team = { model: "sonnet", statusLine: "team" };
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
      // The already-extracted team MCP block — installMcpToClaudeJson takes
      // the in-memory servers object (validated upstream by composeSettings),
      // not a settings-file path.
      const teamMcp = {
        context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
        tldr: { command: "tldr-mcp", args: ["--project", "."] },
      };
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

      await installMcpToClaudeJson(teamMcp, claudeJsonPath);
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
