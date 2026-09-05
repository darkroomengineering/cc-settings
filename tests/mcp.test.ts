// MCP installer suites: the ~/.claude.json installer, annotation-blind
// ownership equality, and the one-time prune of the inert settings.json block.
//
// The user-only-detection / merge-and-preserve / resolveMcpServers suites that
// used to live here were removed with the code they covered: cc-settings no
// longer writes mcpServers into settings.json, because Claude Code never read it
// (nuclear-review-2026-07-29 F6).

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENGINES } from "../src/lib/code-intel-engine.ts";
import { JsonParseError } from "../src/lib/json-io.ts";
import {
  functionalKey,
  installMcpToClaudeJson,
  pruneSettingsMcpServers,
  removeManagedMcpServers,
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

  test("valid HTTP extensions survive unrelated and repeated same-name installs", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-claude-json-"));
    try {
      const claudeJsonPath = join(sandbox, ".claude.json");
      const custom = {
        type: "http" as const,
        url: "https://example.test/mcp",
        oauth: { clientId: "keep-me" },
      };
      await writeFile(claudeJsonPath, JSON.stringify({ mcpServers: { custom } }));
      await installMcpToClaudeJson({ unrelated: { command: "custom-tool" } }, claudeJsonPath);
      expect(JSON.parse(await readFile(claudeJsonPath, "utf8")).mcpServers.custom).toEqual(custom);

      const teamMcp = { custom: { type: "http" as const, url: custom.url } };
      for (let i = 0; i < 2; i++) {
        expect(await installMcpToClaudeJson(teamMcp, claudeJsonPath, teamMcp)).toContain("custom");
        expect(JSON.parse(await readFile(claudeJsonPath, "utf8")).mcpServers.custom).toEqual(
          custom,
        );
      }
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

describe("removeManagedMcpServers — ownership-aware cleanup", () => {
  const current = { figma: { type: "http", url: "https://current.example/mcp" } };
  const prior = { figma: { type: "http", url: "https://prior.example/mcp" } };

  test.each([
    ["current", current.figma],
    ["prior recorded", prior.figma],
  ])("removes the %s cc-settings value", async (_label, installed) => {
    const dir = await mkdtemp(join(tmpdir(), "cc-mcp-remove-owned-"));
    const path = join(dir, ".claude.json");
    try {
      await writeFile(
        path,
        JSON.stringify({ mcpServers: { figma: installed, personal: { command: "mine" } } }),
      );
      await removeManagedMcpServers({ mcpServers: current }, path, prior);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
        mcpServers: { personal: { command: "mine" } },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("preserves a divergent same-name user server", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-mcp-remove-user-"));
    const path = join(dir, ".claude.json");
    const user = { type: "http", url: "https://user.example/mcp" };
    try {
      await writeFile(path, JSON.stringify({ mcpServers: { figma: user } }));
      await removeManagedMcpServers({ mcpServers: current }, path, prior);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ mcpServers: { figma: user } });
    } finally {
      await rm(dir, { recursive: true, force: true });
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

// --- F6: one-time prune of the inert settings.json mcpServers block ---------
//
// Claude Code reads mcpServers from ~/.claude.json only. Installs before
// v12.16.0 also wrote it into settings.json, where it did nothing. The prune
// removes what cc-settings put there and nothing else.
describe("pruneSettingsMcpServers", () => {
  const team = { context7: { command: "bunx", args: ["-y", "@upstash/context7-mcp"] } };

  async function withSettings(
    body: Record<string, unknown>,
    fn: (path: string) => Promise<void>,
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "ccprune-"));
    try {
      const p = join(dir, "settings.json");
      await writeFile(p, JSON.stringify(body, null, 2));
      await fn(p);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("removes an entry cc-settings ships and drops the emptied key", async () => {
    await withSettings({ model: "opus", mcpServers: { ...team } }, async (p) => {
      expect(await pruneSettingsMcpServers(p, team)).toEqual(["context7"]);
      const after = JSON.parse(await readFile(p, "utf8"));
      expect("mcpServers" in after).toBe(false);
      expect(after.model).toBe("opus"); // unrelated keys untouched
    });
  });

  test("keeps a server the user added by hand", async () => {
    await withSettings({ mcpServers: { ...team, mine: { command: "my-server" } } }, async (p) => {
      expect(await pruneSettingsMcpServers(p, team)).toEqual(["context7"]);
      const after = JSON.parse(await readFile(p, "utf8"));
      expect(Object.keys(after.mcpServers)).toEqual(["mine"]);
    });
  });

  test("recognizes a PRIOR install's shape via mcp_written, not just today's", async () => {
    const prior = { context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] } };
    await withSettings({ mcpServers: { ...prior } }, async (p) => {
      // Shape differs from what we ship now, so only the sentinel identifies it.
      expect(await pruneSettingsMcpServers(p, team, prior)).toEqual(["context7"]);
    });
  });

  test("is idempotent — a second run finds nothing and does not rewrite", async () => {
    await withSettings({ mcpServers: { ...team } }, async (p) => {
      expect(await pruneSettingsMcpServers(p, team)).toEqual(["context7"]);
      const first = await readFile(p, "utf8");
      expect(await pruneSettingsMcpServers(p, team)).toEqual([]);
      expect(await readFile(p, "utf8")).toBe(first);
    });
  });

  test("no mcpServers key, or a non-object one, is left strictly alone", async () => {
    await withSettings({ model: "opus" }, async (p) => {
      expect(await pruneSettingsMcpServers(p, team)).toEqual([]);
    });
    // A scalar is not ours and is not safely mergeable — never guess at it.
    await withSettings({ mcpServers: "nonsense" }, async (p) => {
      expect(await pruneSettingsMcpServers(p, team)).toEqual([]);
      expect(JSON.parse(await readFile(p, "utf8")).mcpServers).toBe("nonsense");
    });
  });

  // Regression: a non-object entry under an ENGINE-MANAGED name reaches
  // isStdioServer's `"command" in entry`, which throws on a string. One junk
  // entry would have aborted the whole install. (A junk entry under any other
  // name short-circuits earlier, which is why "tldr" specifically is used here.)
  test("a malformed engine-managed entry is kept, not thrown on", async () => {
    await withSettings({ mcpServers: { tldr: "not-an-object", ...team } }, async (p) => {
      expect(await pruneSettingsMcpServers(p, { ...team, tldr: { command: "bun" } })).toEqual([
        "context7",
      ]);
      const after = JSON.parse(await readFile(p, "utf8"));
      expect(after.mcpServers).toEqual({ tldr: "not-an-object" });
    });
  });

  // A server cc-settings has RETIRED has no teamMcp entry to compare against,
  // so mcp_written is the only remaining ownership evidence.
  test("prunes a retired managed server via mcp_written alone", async () => {
    const retired = { "old-server": { command: "old" } };
    await withSettings({ mcpServers: { ...retired } }, async (p) => {
      expect(await pruneSettingsMcpServers(p, team, retired)).toEqual(["old-server"]);
      expect("mcpServers" in JSON.parse(await readFile(p, "utf8"))).toBe(false);
    });
  });

  // Without recorded provenance, ownership is inferred from shape — so an entry
  // the user copied from ours and annotated must be KEPT. functionalKey() alone
  // would call it ours (annotations are functionally irrelevant) and silently
  // delete the note they wrote.
  test("keeps our shape when the user added their own annotation", async () => {
    const annotated = { context7: { ...team.context7, _comment: "MY OWN NOTE" } };
    await withSettings({ mcpServers: annotated }, async (p) => {
      expect(await pruneSettingsMcpServers(p, team)).toEqual([]);
      const after = JSON.parse(await readFile(p, "utf8"));
      expect(after.mcpServers.context7._comment).toBe("MY OWN NOTE");
    });
  });

  // With provenance, ownership is fact rather than inference, so an annotation
  // difference no longer blocks the prune — mcp_written proves we wrote it.
  test("prunes an annotated entry when mcp_written proves it is ours", async () => {
    await withSettings(
      { mcpServers: { context7: { ...team.context7, _status: "core" } } },
      async (p) => {
        expect(await pruneSettingsMcpServers(p, team, team)).toEqual(["context7"]);
      },
    );
  });

  test("absent settings.json is a no-op, not a throw", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ccprune-"));
    try {
      expect(await pruneSettingsMcpServers(join(dir, "nope.json"), team)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// --- Invariant #1: unparseable JSON aborts loudly --------------------------
//
// The module header's first invariant. Its coverage used to live in the
// settings.json merge suites; those went away with the settings.json write path
// (F6), so it is asserted here directly against both surviving readers. Silently
// treating corrupt JSON as "absent" would let an install overwrite a file whose
// real contents were never read.
describe("corrupt JSON is never treated as absent", () => {
  async function withCorrupt(name: string, fn: (path: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "cccorrupt-"));
    try {
      const p = join(dir, name);
      await writeFile(p, "{ not valid json ");
      await fn(p);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("installMcpToClaudeJson throws on a corrupt ~/.claude.json", async () => {
    await withCorrupt("claude.json", async (p) => {
      await expect(
        installMcpToClaudeJson({ context7: { command: "bunx" } }, p),
      ).rejects.toBeInstanceOf(JsonParseError);
    });
  });

  test("pruneSettingsMcpServers throws on a corrupt settings.json", async () => {
    await withCorrupt("settings.json", async (p) => {
      await expect(
        pruneSettingsMcpServers(p, { context7: { command: "bunx" } }),
      ).rejects.toBeInstanceOf(JsonParseError);
    });
  });
});
