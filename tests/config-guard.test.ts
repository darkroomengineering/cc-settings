// Guard on .mcp.json and plugin manifests: ask rules in config/30-permissions.json
// for what a glob can express, config-guard.ts for shell writes it cannot.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { configWrites, isProtectedConfig, main } from "../src/hooks/config-guard.ts";
import { captureIO } from "../src/lib/hook-runtime.ts";
import { classifyCommand, extractBashRuleSet } from "../src/lib/permissions-check.ts";
import { spawnCapture } from "./support/proc.ts";

const ROOT = resolve(import.meta.dir, "..");
const HOOK = resolve(ROOT, "src", "hooks", "config-guard.ts");

async function asks(tool: string, command: unknown): Promise<string[]> {
  const io = captureIO(JSON.stringify({ tool_name: tool, tool_input: { command } }));
  await main(io);
  return io.asks;
}

describe("isProtectedConfig", () => {
  test.each([
    ".mcp.json",
    "./.mcp.json",
    "/repo/pkg/.mcp.json",
    ".claude-plugin/plugin.json",
    "a\\.claude-plugin\\marketplace.json",
    ".claude-plugin",
  ])("%s is protected", (p) => expect(isProtectedConfig(p)).toBe(true));
  test.each(["mcp.json", ".mcp.json.bak", "plugin.json", "docs/claude-plugin.md"])(
    "%s is not",
    (p) => expect(isProtectedConfig(p)).toBe(false),
  );
});

describe("configWrites: shell writes a permission glob cannot see", () => {
  test.each([
    ["echo '{}' > .mcp.json", "redirects output into .mcp.json"],
    ["cat /tmp/x >> ./.mcp.json", "redirects output into ./.mcp.json"],
    ["printf x >| .claude-plugin/plugin.json", "redirects output into .claude-plugin/plugin.json"],
    ["jq . a.json &> .mcp.json", "redirects output into .mcp.json"],
    ["cat > .mcp.json <<'EOF'\n{}\nEOF", "redirects output into .mcp.json"],
    ["curl -s x | tee -a .mcp.json", "writes .mcp.json through tee"],
    ["sed -i '' 's/a/b/' .mcp.json", "edits .mcp.json in place with sed"],
    [
      "sed -e 's/a/b/' --in-place=.bak .claude-plugin/marketplace.json",
      "edits .claude-plugin/marketplace.json in place with sed",
    ],
    ["perl -pi -e 's/a/b/' .mcp.json", "edits .mcp.json in place with perl"],
    ["cd pkg && echo x > .mcp.json", "redirects output into .mcp.json"],
    ["echo $(echo x > .mcp.json)", "redirects output into .mcp.json"],
  ])("%s", (cmd, finding) => {
    expect(configWrites(cmd)).toEqual([finding]);
  });

  test.each([
    "cat .mcp.json",
    "jq . .mcp.json > /tmp/out.json",
    "sed -n 1p .mcp.json",
    "grep foo .mcp.json 2>&1",
    "tee /tmp/log < .mcp.json",
    "echo '> .mcp.json'",
    "bun test 2>&1 | tail -5",
  ])("%s writes nothing protected", (cmd) => {
    expect(configWrites(cmd)).toEqual([]);
  });
});

describe("config-guard handler", () => {
  test("asks with the findings and the reason", async () => {
    const out = await asks("Bash", "echo x > .mcp.json; tee .claude-plugin/plugin.json < y");
    expect(out).toHaveLength(1);
    expect(out[0]).toStartWith(
      "[Config Guard] redirects output into .mcp.json; writes .claude-plugin/plugin.json through tee.",
    );
    expect(out[0]).toContain("approve only if you asked");
  });

  test("silent for benign commands, other tools and missing input", async () => {
    expect(await asks("Bash", "cat .mcp.json")).toEqual([]);
    expect(await asks("Edit", "echo x > .mcp.json")).toEqual([]);
    expect(await asks("Bash", undefined)).toEqual([]);
  });

  test("as a process: prints one PreToolUse ask envelope, exit 0", async () => {
    const r = await spawnCapture(["bun", HOOK], {
      stdin: JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo {} > .mcp.json" } }),
    });
    expect(r.exit).toBe(0);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBe("ask");
    expect(out.permissionDecisionReason).toContain("redirects output into .mcp.json");
  });
});

describe("config/30-permissions.json ask rules", () => {
  async function config() {
    const raw = JSON.parse(await readFile(resolve(ROOT, "config", "30-permissions.json"), "utf8"));
    return raw.permissions as { ask: string[] };
  }

  test("Edit (which also governs Write) asks on .mcp.json and plugin manifests", async () => {
    const { ask } = await config();
    for (const rule of [
      "Edit(**/.mcp.json)",
      "Edit(**/.claude-plugin/plugin.json)",
      "Edit(**/.claude-plugin/marketplace.json)",
    ]) {
      expect(ask).toContain(rule);
    }
    // Write(path) rules warn at startup since Claude Code 2.1.210.
    expect(ask.filter((r) => r.startsWith("Write("))).toEqual([]);
  });

  test.each([
    ["claude mcp add foo -- npx bar", "Bash(claude mcp add:*)"],
    ["claude mcp add-json foo '{}'", "Bash(claude mcp add-json:*)"],
    ["claude mcp add-from-claude-desktop", "Bash(claude mcp add-from-claude-desktop:*)"],
    ["claude mcp remove foo", "Bash(claude mcp remove:*)"],
    ["claude plugin install x", "Bash(claude plugin install:*)"],
    ["claude plugin marketplace add o/r", "Bash(claude plugin marketplace add:*)"],
    ["cp /tmp/x .mcp.json", "Bash(cp * *.mcp.json*)"],
    ["mv /tmp/x pkg/.mcp.json", "Bash(mv * *.mcp.json*)"],
    ["ln -sf /tmp/x .mcp.json", "Bash(ln * *.mcp.json*)"],
    ["cp /tmp/p.json .claude-plugin/plugin.json", "Bash(cp * *.claude-plugin*)"],
    ["mv /tmp/m.json .claude-plugin/marketplace.json", "Bash(mv * *.claude-plugin*)"],
    ["ln -sfn /tmp/evil .claude-plugin", "Bash(ln * *.claude-plugin*)"],
  ])("%s asks through %s, over the cp/mv allow", async (cmd, rule) => {
    const result = classifyCommand(cmd, extractBashRuleSet(await config()));
    expect(result.decision).toBe("ask");
    expect(result.segments[0]?.matchedRules).toContain(rule);
  });

  test("reading or copying out of the protected files matches no new rule", async () => {
    const full = JSON.parse(await readFile(resolve(ROOT, "config", "30-permissions.json"), "utf8"));
    const rules = extractBashRuleSet(full.permissions);
    for (const cmd of ["jq . .mcp.json", "cp .mcp.json /tmp/backup"]) {
      expect(classifyCommand(cmd, rules).decision).toBe("allow");
    }
  });
});
