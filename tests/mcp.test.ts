// MCP merge integration suites: user-only detection, merge + preserve,
// and the ~/.claude.json installer.

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENGINES } from "../src/lib/code-intel-engine.ts";
import { JsonParseError } from "../src/lib/json-io.ts";
import {
  divergingFields,
  findUserOnlyServers,
  functionalKey,
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

  test("H8: genuine user edit wins for shared key, but stale cc-settings engine output is overwritten", async () => {
    // Regression for the code-intel engine indirection (H8): a PRIOR install
    // resolved "llm-tldr" and wrote its exact shape into ~/.claude.json. This
    // install resolved "native-ts" instead (teamMcp.tldr reflects that). The
    // on-disk tldr entry must be recognized as stale cc-settings output (it
    // canonically matches the llm-tldr engine variant) and get overwritten —
    // NOT preserved as if it were a hand-edit. Meanwhile context7's on-disk
    // value matches no known team/engine shape at all, so it's a genuine user
    // edit and must still win.
    const sandbox = await mkdtemp(join(tmpdir(), "cc-claude-json-engine-"));
    try {
      const llmTldr = ENGINES["llm-tldr"];
      if (!llmTldr) throw new Error("llm-tldr engine missing from ENGINES");
      const teamMcp = {
        context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
        // Simulates setup.ts having resolved to native-ts for THIS run.
        tldr: {
          command: "bun",
          args: ["/fake/claude-dir/src/codemap/mcp-server.ts"],
          serverInstructions: ENGINES["native-ts"]?.serverInstructions ?? "",
        },
      };
      const claudeJsonPath = join(sandbox, ".claude.json");
      await writeFile(
        claudeJsonPath,
        JSON.stringify({
          mcpServers: {
            "user-only": { command: "custom" },
            // Genuine user edit — matches neither team's context7 definition
            // nor anything cc-settings would have generated for it.
            context7: { command: "user-override" },
            // Stale output from a PRIOR install that resolved llm-tldr —
            // byte-identical to that engine variant, not a hand-edit.
            tldr: {
              command: llmTldr.mcp.command,
              args: llmTldr.mcp.args,
              serverInstructions: llmTldr.serverInstructions,
            },
          },
        }),
      );

      await installMcpToClaudeJson(teamMcp, claudeJsonPath);
      const result = JSON.parse(await readFile(claudeJsonPath, "utf8"));
      // Genuine user edit of a non-engine-managed server still wins.
      expect(result.mcpServers.context7.command).toBe("user-override");
      // Stale cc-settings tldr output is replaced by the freshly-resolved engine.
      expect(result.mcpServers.tldr).toEqual(teamMcp.tldr);
      // Unrelated user-only server still preserved.
      expect(result.mcpServers["user-only"].command).toBe("custom");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test(
    "FIX B: prior mcp_written snapshot recognizes stale output even after " +
      "serverInstructions text drifted",
    async () => {
      // Regression: isStaleCcOutput's live-registry loop can only recognize
      // shapes the CURRENT code would generate. A prior install wrote a
      // serverInstructions string that has since been edited in ENGINES (e.g.
      // v12.8.1 / v12.9.0 wording changes) — that on-disk entry no longer
      // matches ANY live candidate and would be misclassified as a hand-edit
      // without the sentinel's mcp_written snapshot.
      const sandbox = await mkdtemp(join(tmpdir(), "cc-claude-json-mcpwritten-"));
      try {
        // Literal prior-version serverInstructions — deliberately NOT sourced
        // from the live ENGINES registry, so this test can't be tautological.
        const priorInstructions =
          "Semantic codebase analysis and repository-level search over the current project. 17 languages auto-detected. Use when you need to find where something is implemented, understand large or unfamiliar code, trace call graphs, or answer questions that require scanning many files across the codebase. Do not hardcode the language parameter — auto-detection is preferred.";
        const teamMcp = {
          tldr: {
            command: "bun",
            args: ["/fake/claude-dir/src/codemap/mcp-server.ts"],
            serverInstructions: ENGINES["native-ts"]?.serverInstructions ?? "",
          },
        };
        const claudeJsonPath = join(sandbox, ".claude.json");
        await writeFile(
          claudeJsonPath,
          JSON.stringify({
            mcpServers: {
              // Stale output from a prior install, whose serverInstructions
              // text no longer matches any current ENGINES entry.
              tldr: {
                command: "tldr-mcp",
                args: ["--project", "."],
                serverInstructions: priorInstructions,
              },
            },
          }),
        );
        const mcpWritten = {
          tldr: {
            command: "tldr-mcp",
            args: ["--project", "."],
            serverInstructions: priorInstructions,
          },
        };

        await installMcpToClaudeJson(teamMcp, claudeJsonPath, mcpWritten);
        const result = JSON.parse(await readFile(claudeJsonPath, "utf8"));
        // Recognized as stale cc-settings output via mcp_written — overwritten
        // with the freshly-resolved engine, not preserved as a hand-edit.
        expect(result.mcpServers.tldr).toEqual(teamMcp.tldr);
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    },
  );

  test("FIX B: a genuine hand-edit that doesn't match mcp_written is still preserved", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-claude-json-mcpwritten-handedit-"));
    try {
      const teamMcp = {
        tldr: {
          command: "bun",
          args: ["/fake/claude-dir/src/codemap/mcp-server.ts"],
          serverInstructions: ENGINES["native-ts"]?.serverInstructions ?? "",
        },
      };
      const claudeJsonPath = join(sandbox, ".claude.json");
      await writeFile(
        claudeJsonPath,
        JSON.stringify({
          mcpServers: {
            // A genuine user hand-edit — matches neither teamMcp nor mcp_written.
            tldr: { command: "my-custom-tldr", args: [] },
          },
        }),
      );
      const mcpWritten = {
        tldr: {
          command: "tldr-mcp",
          args: ["--project", "."],
          serverInstructions: "some prior wording that isn't this hand-edit either",
        },
      };

      await installMcpToClaudeJson(teamMcp, claudeJsonPath, mcpWritten);
      const result = JSON.parse(await readFile(claudeJsonPath, "utf8"));
      // Hand-edit wins — not recognized as stale by either the live registry
      // or the mcp_written snapshot.
      expect(result.mcpServers.tldr.command).toBe("my-custom-tldr");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("a null/scalar entry among valid servers is dropped, not cast (no throw)", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-claude-json-badentry-"));
    try {
      const claudeJsonPath = join(sandbox, ".claude.json");
      // A map with a null and an array entry fails McpServersSchema, forcing the
      // per-entry raw-preserve path. Downstream `"command" in entry` would throw
      // on the null — the fix keeps object entries and drops the rest.
      await writeFile(
        claudeJsonPath,
        JSON.stringify({
          mcpServers: {
            "user-good": { command: "keep-me" },
            "user-bad-null": null,
            "user-bad-array": [1, 2],
          },
        }),
      );
      const teamMcp = { context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] } };
      // Must not throw on the null entry.
      await installMcpToClaudeJson(teamMcp, claudeJsonPath);
      const result = JSON.parse(await readFile(claudeJsonPath, "utf8"));
      // Team + the valid object entry survive; the null/array entries are gone.
      expect(Object.keys(result.mcpServers).sort()).toEqual(["context7", "user-good"]);
      expect(result.mcpServers["user-good"].command).toBe("keep-me");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

// --- Override reporting ----------------------------------------------------
//
// Backstory: a stale `tldr` entry (llm-tldr shape, pre-v12.8.1 instruction text)
// sat in settings.json across many installs. Every run classified it as a user
// customization and preserved it, and the install summary said only "user-added"
// — so nothing on screen distinguished "cc-settings ships this" from
// "cc-settings' definition is the one running". These two surfaces close that.

describe("divergingFields", () => {
  test("names the fields that differ", () => {
    expect(
      divergingFields(
        { command: "tldr-mcp", args: ["--project", "."], serverInstructions: "old text" },
        { command: "tldr-mcp", args: ["--project", "."], serverInstructions: "new text" },
      ),
    ).toEqual(["serverInstructions"]);
  });

  test("identical definitions diverge in nothing", () => {
    const a = { command: "bunx", args: ["-y", "pkg"] };
    expect(divergingFields(a, { ...a })).toEqual([]);
  });

  test("field ORDER alone is not a divergence", () => {
    expect(
      divergingFields({ command: "bunx", args: ["-y"] }, { args: ["-y"], command: "bunx" }),
    ).toEqual([]);
  });

  test("a key present on one side only counts as diverging", () => {
    expect(divergingFields({ command: "x" }, { command: "x", env: { A: "1" } })).toEqual(["env"]);
  });

  test("sorted, and reports every differing field", () => {
    expect(divergingFields({ command: "a", args: ["1"] }, { command: "b", args: ["2"] })).toEqual([
      "args",
      "command",
    ]);
  });
});

describe("installMcpToClaudeJson — reports shadowed shipped servers", () => {
  test("returns the shipped names whose user definition won", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-mcp-override-"));
    try {
      const claudeJsonPath = join(dir, "claude.json");
      // The user's `tldr` is a genuine hand-edit (matches neither the team entry
      // nor any known engine variant), so it survives the merge and shadows ours.
      await writeFile(
        claudeJsonPath,
        JSON.stringify({
          mcpServers: {
            tldr: { command: "my-own-tldr", args: ["--custom"] },
            context7: { command: "bunx", args: ["-y", "@upstash/context7-mcp"] },
          },
        }),
        "utf8",
      );
      const teamMcp = {
        tldr: { command: "bun", args: ["/x/mcp-server.ts"] },
        context7: { command: "bunx", args: ["-y", "@upstash/context7-mcp"] },
      };
      const overridden = await installMcpToClaudeJson(teamMcp, claudeJsonPath);

      // tldr diverges → reported. context7 is byte-identical → not an override.
      expect(overridden).toEqual(["tldr"]);

      // And the user's definition is genuinely what landed.
      const written = JSON.parse(await readFile(claudeJsonPath, "utf8"));
      expect(written.mcpServers.tldr.command).toBe("my-own-tldr");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("no team servers → nothing overridden", async () => {
    expect(await installMcpToClaudeJson({}, "/nonexistent/claude.json")).toEqual([]);
  });
});

// --- Annotation-blind ownership -------------------------------------------
//
// Backstory: pre-strip installs wrote `_status`/`_comment` inline in
// ~/.claude.json. Those keys are documentation-only — Claude Code ignores them
// and the composer no longer emits them — but they made an otherwise identical
// entry compare unequal to ours. isStaleCcOutput then called it a hand-edit,
// the merge preserved it, and cc-settings' updates to that server could never
// land again. Observed on a real install: figma and chrome-devtools differed
// from the team entry in `_comment` and `_status` and nothing else.

describe("functionalKey — annotation-blind equality", () => {
  test("`_`-prefixed keys do not affect identity", () => {
    expect(functionalKey({ command: "bunx", _status: "core", _comment: "x" })).toBe(
      functionalKey({ command: "bunx" }),
    );
  });

  test("functional fields still distinguish", () => {
    expect(functionalKey({ command: "a" })).not.toBe(functionalKey({ command: "b" }));
  });
});

describe("divergingFields ignores annotations", () => {
  test("annotation-only difference is not a divergence", () => {
    expect(
      divergingFields(
        { type: "http", url: "https://x", _status: "core", _comment: "note" },
        { type: "http", url: "https://x" },
      ),
    ).toEqual([]);
  });

  test("a real customization alongside annotations still reports only real fields", () => {
    expect(
      divergingFields({ type: "http", url: "https://mine", _status: "core" }, { command: "bunx" }),
    ).toEqual(["command", "type", "url"]);
  });
});

describe("installMcpToClaudeJson — annotation residue no longer pins an entry", () => {
  test("entry differing ONLY in _status/_comment is refreshed, not preserved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-mcp-annot-"));
    try {
      const claudeJsonPath = join(dir, "claude.json");
      // Exactly the real-world shape: our definition, functionally identical,
      // carrying a legacy annotation. Before the fix that key alone transferred
      // ownership to the user; the point of the assertion is that it no longer
      // does, and that the residue is dropped from disk.
      await writeFile(
        claudeJsonPath,
        JSON.stringify({
          mcpServers: {
            figma: { type: "http", url: "https://mcp.figma.com/mcp", _status: "core" },
          },
        }),
        "utf8",
      );
      const teamMcp = { figma: { type: "http" as const, url: "https://mcp.figma.com/mcp" } };

      const overridden = await installMcpToClaudeJson(teamMcp, claudeJsonPath);
      expect(overridden).toEqual([]); // not treated as a user override anymore

      // Ours won, so the stale annotations are gone from disk.
      const written = JSON.parse(await readFile(claudeJsonPath, "utf8"));
      expect(written.mcpServers.figma._status).toBeUndefined();
      expect(written.mcpServers.figma.url).toBe("https://mcp.figma.com/mcp");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a genuine customization carrying annotations is STILL preserved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-mcp-annot-keep-"));
    try {
      const claudeJsonPath = join(dir, "claude.json");
      // The real context7 case: user switched to the hosted HTTP endpoint with
      // their own key. Differs in real fields, so it must keep winning.
      const mine = {
        type: "http",
        url: "https://mcp.context7.com/mcp",
        headers: { CONTEXT7_API_KEY: "secret" },
        _status: "core",
      };
      await writeFile(claudeJsonPath, JSON.stringify({ mcpServers: { context7: mine } }), "utf8");
      const teamMcp = { context7: { command: "bunx", args: ["-y", "@upstash/context7-mcp"] } };

      const overridden = await installMcpToClaudeJson(teamMcp, claudeJsonPath);
      expect(overridden).toEqual(["context7"]);

      const written = JSON.parse(await readFile(claudeJsonPath, "utf8"));
      expect(written.mcpServers.context7.headers.CONTEXT7_API_KEY).toBe("secret");
      expect(written.mcpServers.context7.command).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("annotation stripping is a closed list, not a `_` prefix test", () => {
  // An unknown `_`-prefixed field may be a real Claude Code extension we don't
  // model yet. Treating it as decoration would let the merge silently overwrite
  // it, so it must still register as a divergence.
  test("unknown `_` field still counts as functional", () => {
    expect(functionalKey({ command: "x", _futureFlag: true })).not.toBe(
      functionalKey({ command: "x" }),
    );
    expect(divergingFields({ command: "x", _futureFlag: true }, { command: "x" })).toEqual([
      "_futureFlag",
    ]);
  });

  test("every documented commentary key is ignored", () => {
    const bare = { command: "x" };
    const annotated = {
      command: "x",
      _comment: "c",
      _description: "d",
      _usage: "u",
      _contextCost: "low",
      _status: "core",
    };
    expect(functionalKey(annotated)).toBe(functionalKey(bare));
  });

  test("serverInstructions is functional, never stripped", () => {
    expect(functionalKey({ command: "x", serverInstructions: "a" })).not.toBe(
      functionalKey({ command: "x", serverInstructions: "b" }),
    );
  });
});

// --- Recovery across a changed shipped definition --------------------------
//
// The gap v12.11.0 documented but did not close: mcp_written only ever recorded
// the engine-managed `tldr`, so for any OTHER managed server the only
// recognizable shapes were the ones the CURRENT code generates. Change a
// server's shipped definition and the entry it replaced matched nothing, read
// as a hand-edit, and was preserved forever — cc-settings could never update
// that server again on that machine. Now every managed server is recorded.

describe("installMcpToClaudeJson — recovery when our own definition changed", () => {
  test("prior-shipped entry is replaced by the new definition", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-mcp-recover-"));
    try {
      const claudeJsonPath = join(dir, "claude.json");
      // What last install shipped, still sitting on disk.
      const previouslyShipped = { type: "http" as const, url: "https://old.figma.example/mcp" };
      await writeFile(
        claudeJsonPath,
        JSON.stringify({ mcpServers: { figma: previouslyShipped } }),
        "utf8",
      );
      // We now ship a different URL.
      const teamMcp = { figma: { type: "http" as const, url: "https://new.figma.example/mcp" } };

      const overridden = await installMcpToClaudeJson(teamMcp, claudeJsonPath, {
        figma: previouslyShipped,
      });

      expect(overridden).toEqual([]); // recognized as ours, not a hand-edit
      const written = JSON.parse(await readFile(claudeJsonPath, "utf8"));
      expect(written.mcpServers.figma.url).toBe("https://new.figma.example/mcp");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("without the record, the same entry is preserved (the pre-fix behaviour)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-mcp-recover-none-"));
    try {
      const claudeJsonPath = join(dir, "claude.json");
      await writeFile(
        claudeJsonPath,
        JSON.stringify({
          mcpServers: { figma: { type: "http", url: "https://old.figma.example/mcp" } },
        }),
        "utf8",
      );
      const teamMcp = { figma: { type: "http" as const, url: "https://new.figma.example/mcp" } };

      // No mcpWritten — exactly what a pre-v12.12.0 sentinel offers for figma.
      const overridden = await installMcpToClaudeJson(teamMcp, claudeJsonPath);

      expect(overridden).toEqual(["figma"]);
      const written = JSON.parse(await readFile(claudeJsonPath, "utf8"));
      expect(written.mcpServers.figma.url).toBe("https://old.figma.example/mcp");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a real hand-edit is NOT clobbered by the record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-mcp-recover-user-"));
    try {
      const claudeJsonPath = join(dir, "claude.json");
      // User pointed figma somewhere of their own. Differs from what we shipped
      // last time AND from what we ship now, so it must survive.
      await writeFile(
        claudeJsonPath,
        JSON.stringify({
          mcpServers: { figma: { type: "http", url: "https://mine.example/mcp" } },
        }),
        "utf8",
      );
      const teamMcp = { figma: { type: "http" as const, url: "https://new.figma.example/mcp" } };

      const overridden = await installMcpToClaudeJson(teamMcp, claudeJsonPath, {
        figma: { type: "http", url: "https://old.figma.example/mcp" },
      });

      expect(overridden).toEqual(["figma"]);
      const written = JSON.parse(await readFile(claudeJsonPath, "utf8"));
      expect(written.mcpServers.figma.url).toBe("https://mine.example/mcp");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveMcpServers — settings.json gets the same stale-output test", () => {
  // Codex caught this: extending mcp_written fixed ~/.claude.json only.
  // settings.json holds its own copy of the MCP block and had NO stale
  // detection at all, so a definition cc-settings wrote on an older version was
  // read as a user customization and preserved forever. That is precisely how a
  // pre-v12.8.1 `tldr` entry survived every reinstall on a real machine while
  // ~/.claude.json was being updated correctly the whole time.
  const oldShipped = { command: "tldr-mcp", args: ["--project", "."] };
  const nowShipped = { command: "bun", args: ["/x/codemap/mcp-server.ts"] };

  test("prior-shipped definition is replaced, not preserved", async () => {
    const resolved = await resolveMcpServers(
      { tldr: oldShipped },
      { tldr: nowShipped },
      {
        tldr: oldShipped,
      },
    );
    expect(resolved.tldr).toEqual(nowShipped);
  });

  test("without the record it is preserved (the behaviour that stranded settings.json)", async () => {
    const resolved = await resolveMcpServers({ tldr: oldShipped }, { tldr: nowShipped });
    expect(resolved.tldr).toEqual(oldShipped);
  });

  test("a genuine customization is still preserved even with a record present", async () => {
    const mine = { command: "my-own-tldr", args: ["--mine"] };
    const resolved = await resolveMcpServers(
      { tldr: mine },
      { tldr: nowShipped },
      {
        tldr: oldShipped,
      },
    );
    expect(resolved.tldr).toEqual(mine);
  });

  test("annotation residue on a prior-shipped entry does not block recovery", async () => {
    const resolved = await resolveMcpServers(
      { tldr: { ...oldShipped, _status: "core" as const } },
      { tldr: nowShipped },
      { tldr: oldShipped },
    );
    expect(resolved.tldr).toEqual(nowShipped);
  });
});
