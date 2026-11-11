// Tests for the Codex-to-Claude bridge (src/lib/claude-bridge.ts). Preflight and
// arg building are pure; runClaudePrint is exercised against a fake `claude` on PATH.

import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  buildClaudeArgs,
  CLAUDE_BRIDGE_DEFAULT_MODEL,
  preflightClaudeBridge,
  resolveClaudeModel,
} from "../src/lib/claude-bridge.ts";
import { gitBashPath, prependTestPath } from "./support/portable-process.ts";

const BRIDGE = resolve(import.meta.dir, "../src/lib/claude-bridge.ts");

// Above the 10s spawn timeout of the timeout scenario, so a hung scenario fails on
// its exit code with its stderr instead of on the test timeout.
const SPAWNING_TEST_TIMEOUT_MS = 30_000;

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
  test("defaults to Opus 5.5", () => {
    expect(resolveClaudeModel(undefined, {})).toEqual({
      ok: true,
      model: CLAUDE_BRIDGE_DEFAULT_MODEL,
    });
    expect(CLAUDE_BRIDGE_DEFAULT_MODEL).toBe("claude-opus-5-5");
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

describe("buildClaudeArgs and runClaudePrint", () => {
  test("is headless, read-only, and non-interactive", () => {
    const args = buildClaudeArgs("claude-opus-5-5");
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

  test("never puts the prompt on argv: runClaudePrint delivers it on stdin only", async () => {
    // Business rule: a prompt can start with "--" or carry shell text; on argv it
    // would be parsed as flags and leak into process listings.
    // Bun.spawn resolves the command against the PATH the process started with,
    // so the fake `claude` must be on PATH at launch: run the bridge in a child.
    const dir = await mkdtemp(join(tmpdir(), "cc-claude-bridge-"));
    try {
      const argvFile = join(dir, "argv.txt");
      const stdinFile = join(dir, "stdin.txt");
      const fake = join(dir, "claude");
      await writeFile(
        fake,
        `#!/bin/sh\nprintf '%s\\n' "$@" > '${gitBashPath(argvFile)}'\ncat > '${gitBashPath(stdinFile)}'\necho ok\n`,
      );
      await chmod(fake, 0o755);
      const prompt = "--dangerous-looking prompt\nTask: review";
      const driver = join(dir, "driver.ts");
      await writeFile(
        driver,
        `import { runClaudePrint } from ${JSON.stringify(BRIDGE)};
console.log(JSON.stringify(await runClaudePrint({ prompt: ${JSON.stringify(prompt)}, model: "sonnet" })));
`,
      );
      const env: Record<string, string | undefined> = {
        ...process.env,
        PATH: prependTestPath(dir),
      };
      delete env.CLAUDECODE;
      delete env.CODEX_SANDBOX_NETWORK_DISABLED;
      const proc = Bun.spawn([process.execPath, driver], { env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      const result = JSON.parse(stdout) as { ok: boolean; output?: string };
      expect(result, stderr).toEqual({ ok: true, output: "ok" });
      expect(await readFile(stdinFile, "utf8")).toBe(prompt);
      const argv = (await readFile(argvFile, "utf8")).split("\n");
      expect(argv).toContain("sonnet");
      expect(
        argv.some((line) => line.includes("dangerous-looking") || line.includes("Task:")),
      ).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("runClaudePrint timeout", () => {
  test(
    "returns the partial output while a process Claude started still holds the pipes",
    async () => {
      // The subshell exits at once, so the holder is no longer a descendant of
      // the fake Claude and outlives the kill. It stops when the scenario
      // directory, and with it the started marker, is removed.
      const dir = await mkdtemp(join(tmpdir(), "cc-claude-bridge-"));
      try {
        const started = join(dir, "started");
        const fake = join(dir, "claude");
        await writeFile(
          fake,
          `#!/bin/sh\necho partial\n(sh -c 'touch "$0"; while [ -f "$0" ]; do sleep 0.01; done' '${gitBashPath(started)}' &)\nwhile :; do sleep 0.01; done\n`,
        );
        await chmod(fake, 0o755);
        const script = `
          import { runClaudePrint } from ${JSON.stringify(BRIDGE)};
          const startedAt = Date.now();
          const run = await runClaudePrint({ prompt: "test", model: "sonnet", timeoutMs: 2000 });
          const overshootMs = Date.now() - startedAt - 2000;
          console.log(JSON.stringify({
            ok: run.ok, detail: run.ok ? "" : run.detail, output: run.output ?? null,
            holderStarted: await Bun.file(${JSON.stringify(started)}).exists(), overshootMs,
          }));
        `;
        const env: Record<string, string | undefined> = {
          ...process.env,
          PATH: prependTestPath(dir),
        };
        delete env.CLAUDECODE;
        delete env.CODEX_SANDBOX_NETWORK_DISABLED;
        const child = Bun.spawn([process.execPath, "--eval", script], {
          env,
          stdout: "pipe",
          stderr: "pipe",
          timeout: 10_000,
        });
        const [stdout, stderr, exit] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect(exit, stderr).toBe(0);
        const { overshootMs, detail, ...run } = z
          .object({
            ok: z.boolean(),
            detail: z.string(),
            output: z.string().nullable(),
            holderStarted: z.boolean(),
            overshootMs: z.number(),
          })
          .parse(JSON.parse(stdout));
        expect(run).toEqual({ ok: false, output: "partial", holderStarted: true });
        expect(detail).toContain("timed out");
        expect(overshootMs).toBeLessThan(2500);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    SPAWNING_TEST_TIMEOUT_MS,
  );
});
