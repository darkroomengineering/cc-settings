// Smoke tests for Phase 2 leaf-script TS ports. Confirms:
//   - Scripts exit 0 on expected inputs.
//   - Scripts produce their documented stdout.
// Not a bit-for-bit parity suite with the bash versions; parity was validated
// manually during port (see commit message). These tests lock in behavior so
// Phase 4/6 doesn't regress during hook cutover.
//
// Run: bun test tests/phase2-scripts.test.ts

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const SRC = resolve(import.meta.dir, "..", "src", "scripts");

async function run(
  script: string,
  opts: { env?: Record<string, string>; stdin?: string; args?: string[] } = {},
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", resolve(SRC, script), ...(opts.args ?? [])], {
    env: { ...process.env, ...opts.env },
    stdin: opts.stdin !== undefined ? "pipe" : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (opts.stdin !== undefined) {
    proc.stdin.write(opts.stdin);
    proc.stdin.end();
  }
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exit = await proc.exited;
  return { exit, stdout, stderr };
}

describe("notify.ts", () => {
  test("no message → no-op, exit 0", async () => {
    const r = await run("notify.ts", { env: { NOTIFICATION_MESSAGE: "" } });
    expect(r.exit).toBe(0);
  });
});

describe("post-compact.ts", () => {
  test("prints recovery steps", async () => {
    const r = await run("post-compact.ts");
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("[PostCompact]");
    expect(r.stdout).toContain("1. Re-read your active task plan");
  });
});

describe("stop-failure.ts", () => {
  test("rate-limit message produces rate-limit branch", async () => {
    const payload = JSON.stringify({ error: { type: "rate_limit", message: "429 overloaded" } });
    const r = await run("stop-failure.ts", { stdin: payload });
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("Rate limit hit");
  });
  test("generic error produces generic branch", async () => {
    const payload = JSON.stringify({ error: { type: "server", message: "boom" } });
    const r = await run("stop-failure.ts", { stdin: payload });
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("API error");
  });
  test("empty stdin → unknown/Unknown error", async () => {
    const r = await run("stop-failure.ts", { stdin: "" });
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("API error");
    expect(r.stdout).toContain("unknown");
  });
});

describe("check-docs-before-install.ts", () => {
  test("bun add react → prompts", async () => {
    const r = await run("check-docs-before-install.ts", {
      env: { TOOL_INPUT_command: "bun add react" },
    });
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("Installing 'react'");
  });
  test("bun add -D typescript → flags skipped", async () => {
    // The first non-flag arg after `bun add` is `-D`, which we skip.
    const r = await run("check-docs-before-install.ts", {
      env: { TOOL_INPUT_command: "bun add -D typescript" },
    });
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });
  test("empty command → no-op", async () => {
    const r = await run("check-docs-before-install.ts", { env: { TOOL_INPUT_command: "" } });
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });
  test("non-install command → no-op", async () => {
    const r = await run("check-docs-before-install.ts", {
      env: { TOOL_INPUT_command: "ls -la" },
    });
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("post-edit-tsc.ts", () => {
  test("non-TS file → no-op", async () => {
    const r = await run("post-edit-tsc.ts", { env: { TOOL_INPUT_file_path: "foo.py" } });
    expect(r.exit).toBe(0);
  });
  test("empty file_path → no-op", async () => {
    const r = await run("post-edit-tsc.ts", { env: { TOOL_INPUT_file_path: "" } });
    expect(r.exit).toBe(0);
  });
});

describe("post-edit.ts", () => {
  test("empty file_path → no-op", async () => {
    const r = await run("post-edit.ts", { env: { TOOL_INPUT_file_path: "" } });
    expect(r.exit).toBe(0);
  });
});

describe("track-tldr.ts + tldr-stats.ts", () => {
  test("track increments a stats file, stats reads + clears it", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const sandbox = mkdtempSync(join(tmpdir(), "cc-tldr-test-"));
    try {
      // We can't easily redirect HOME per spawn — just call the scripts in sequence
      // with HOME overridden.
      const env = { HOME: sandbox };
      const rTrack = await run("track-tldr.ts", { env, args: ["mcp__tldr__semantic"] });
      expect(rTrack.exit).toBe(0);
      const rStats = await run("tldr-stats.ts", { env });
      expect(rStats.exit).toBe(0);
      expect(rStats.stdout).toContain("Calls: 1");
      expect(rStats.stdout).toContain("1000"); // semantic = 1000 saved
      // After stats runs, file should be deleted.
      const rStats2 = await run("tldr-stats.ts", { env });
      expect(rStats2.exit).toBe(0);
      expect(rStats2.stdout).toBe("");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe("log-bash.ts", () => {
  test("logs a bash command line to dated file", async () => {
    const { mkdtempSync, rmSync, readdirSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const sandbox = mkdtempSync(join(tmpdir(), "cc-logbash-test-"));
    try {
      const env = { HOME: sandbox };
      const payload = JSON.stringify({ tool_input: { command: "echo hello" } });
      const r = await run("log-bash.ts", { env, stdin: payload });
      expect(r.exit).toBe(0);
      const logDir = join(sandbox, ".claude", "logs");
      const files = readdirSync(logDir).filter((f) => f.startsWith("bash-"));
      expect(files.length).toBe(1);
      const first = files[0];
      if (!first) throw new Error("expected a log file");
      const content = readFileSync(join(logDir, first), "utf8");
      expect(content).toContain("echo hello");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe("post-failure.ts", () => {
  test("3rd failure emits warn line", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const sandbox = mkdtempSync(join(tmpdir(), "cc-postfail-test-"));
    try {
      const env = { HOME: sandbox, TOOL_NAME: "Grep", TOOL_ERROR: "no such file" };
      await run("post-failure.ts", { env });
      await run("post-failure.ts", { env });
      const r = await run("post-failure.ts", { env });
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain("failed 3 times");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe("claude-audit.ts", () => {
  test("no logs → prints header + 'no data'", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const sandbox = mkdtempSync(join(tmpdir(), "cc-audit-test-"));
    try {
      const r = await run("claude-audit.ts", { env: { HOME: sandbox } });
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain("Claude Audit");
      expect(r.stdout).toContain("Today: no data");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
