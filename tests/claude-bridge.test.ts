// Unit tests for the pure parts of the Codex-to-Claude bridge (src/lib/claude-bridge.ts).
// No subprocess spawning — preflight is driven by injected env and PATH probes.

import { describe, expect, test } from "bun:test";
import {
  buildClaudeArgs,
  CLAUDE_BRIDGE_DEFAULT_MODEL,
  preflightClaudeBridge,
  resolveClaudeModel,
} from "../src/lib/claude-bridge.ts";

describe("preflightClaudeBridge", () => {
  test("refuses inside a Claude Code session before checking anything else", () => {
    const verdict = preflightClaudeBridge({ CLAUDECODE: "1" }, () => true);
    expect(verdict.state).toBe("inside-claude");
    expect(verdict.detail).toContain("codex-run.ts");
  });

  test("reports a Codex sandbox with network disabled and names the config fix", () => {
    const verdict = preflightClaudeBridge({ CODEX_SANDBOX_NETWORK_DISABLED: "1" }, () => true);
    expect(verdict.state).toBe("network-disabled");
    expect(verdict.detail).toContain("network_access = true");
  });

  test("reports a missing claude binary", () => {
    const verdict = preflightClaudeBridge({}, () => false);
    expect(verdict.state).toBe("not-installed");
  });

  test("is available from a plain shell or a Codex thread with network", () => {
    expect(preflightClaudeBridge({ CODEX_THREAD_ID: "t" }, () => true).state).toBe("available");
  });
});

describe("resolveClaudeModel", () => {
  test("defaults to Opus 5", () => {
    expect(resolveClaudeModel(undefined, {})).toEqual({
      ok: true,
      model: CLAUDE_BRIDGE_DEFAULT_MODEL,
    });
    expect(CLAUDE_BRIDGE_DEFAULT_MODEL).toBe("claude-opus-5");
  });

  test("flag beats env beats default", () => {
    expect(resolveClaudeModel(undefined, { CLAUDE_BRIDGE_MODEL: "sonnet" })).toEqual({
      ok: true,
      model: "sonnet",
    });
    expect(resolveClaudeModel("opus[1m]", { CLAUDE_BRIDGE_MODEL: "sonnet" })).toEqual({
      ok: true,
      model: "opus[1m]",
    });
  });

  test("rejects a value that could read as a flag or shell text", () => {
    expect(resolveClaudeModel("--dangerously-skip-permissions", {}).ok).toBe(false);
    expect(resolveClaudeModel("opus; rm -rf /", {}).ok).toBe(false);
  });
});

describe("buildClaudeArgs", () => {
  test("is headless, read-only, and non-interactive", () => {
    const args = buildClaudeArgs("claude-opus-5");
    expect(args[0]).toBe("claude");
    expect(args).toContain("-p");
    expect(args).toContain("--no-session-persistence");
    const mode = args[args.indexOf("--permission-mode") + 1];
    expect(mode).toBe("dontAsk");
    const tools = args[args.indexOf("--tools") + 1] as string;
    for (const editing of ["Edit", "Write", "NotebookEdit", "Agent"]) {
      expect(tools.split(",")).not.toContain(editing);
    }
    const allowed = args[args.indexOf("--allowedTools") + 1] as string;
    expect(allowed).toContain("Bash(git diff:*)");
    expect(allowed).not.toContain("Bash(git push");
  });

  test("never puts the prompt on argv", () => {
    const args = buildClaudeArgs("sonnet");
    expect(args.some((arg) => arg.includes("review") || arg.includes("Task:"))).toBe(false);
  });
});
