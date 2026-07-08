// log-bash.ts regression: M19 — an explicit CLAUDE_LOG_RETENTION_DAYS=0 must
// stay 0 (prune everything not created in "this instant"), not silently
// coerce back to the 1-day default via the falsy-zero `Number.parseInt(...)
// || 1` bug. See docs/audits/codebase-audit-2026-07-08.md.
//
// HOME is sandboxed to a tmp dir per test — log-bash.ts writes under
// ~/.claude/logs (claudePath), so pruning behavior is fully observable
// without touching the real ~/.claude tree.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "..", "src", "scripts", "log-bash.ts");

async function run(
  home: string,
  command: string,
  env: Record<string, string> = {},
): Promise<{ exit: number }> {
  const proc = Bun.spawn(["bun", SCRIPT], {
    env: { ...process.env, HOME: home, USERPROFILE: home, ...env },
    stdin: "pipe",
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.stdin.write(JSON.stringify({ tool_input: { command } }));
  await proc.stdin.end();
  const exit = await proc.exited;
  return { exit };
}

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "cc-log-bash-home-"));
  await mkdir(join(home, ".claude", "logs"), { recursive: true });
  return home;
}

describe("log-bash.ts — CLAUDE_LOG_RETENTION_DAYS falsy-zero guard (M19)", () => {
  test("CLAUDE_LOG_RETENTION_DAYS=0 prunes a pre-existing log file, not kept as if it fell back to 1", async () => {
    const home = await makeHome();
    try {
      const stale = join(home, ".claude", "logs", "bash-2000-01-01.log");
      await writeFile(stale, "[00:00:00] [proj] echo old\n");

      await run(home, "echo hi", { CLAUDE_LOG_RETENTION_DAYS: "0" });

      // cutoff = now - 0 days = now, so anything already on disk (created
      // strictly before the prune check ran) must be gone. Before the fix,
      // `0 || 1` silently became 1, and this file (created "today", well
      // within a 1-day window) would have survived instead.
      expect(await Bun.file(stale).exists()).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("unset CLAUDE_LOG_RETENTION_DAYS keeps a fresh log file (1-day default, sanity check)", async () => {
    const home = await makeHome();
    try {
      const fresh = join(
        home,
        ".claude",
        "logs",
        `bash-${new Date().toISOString().slice(0, 10)}.log`,
      );
      await writeFile(fresh, "[00:00:00] [proj] echo fresh\n");

      await run(home, "echo hi");

      // Default retention is 1 day — a file created moments ago must survive.
      expect(await Bun.file(fresh).exists()).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("log-bash.ts — secret redaction on the highest-exposure logging path (M23)", () => {
  test("a command containing a password= credential is redacted in the written log line", async () => {
    const home = await makeHome();
    try {
      await run(home, "curl -u user:password=hunter2 https://api.example.com", {
        CLAUDE_LOG_RETENTION_DAYS: "365",
      });

      const today = new Date().toISOString().slice(0, 10);
      const logPath = join(home, ".claude", "logs", `bash-${today}.log`);
      const content = await readFile(logPath, "utf8");
      expect(content).not.toContain("hunter2");
      expect(content).toContain("password=[redacted]");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
