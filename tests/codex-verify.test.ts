// src/hooks/codex-verify.ts — SessionStart default-on policy injection.
//
// The hook is spawned as a subprocess with a sandboxed HOME (same pattern as
// tests/promote-memory.test.ts) so it never touches the real ~/.claude state.
//
//   - "available" verdict pre-seeded in the state cache → refreshCodexVerdict
//     short-circuits on the fresh-"available" TTL path (no live spawn needed),
//     and the hook must emit additionalContext containing "codex:default-on".
//   - any other verdict (here: no cache + PATH stripped so `codex` can't be
//     found, forcing a deterministic "not-installed" live check) → the hook
//     must emit no additionalContext at all.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "codex-verify.ts");

interface HookOutput {
  hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
}

async function runHook(
  home: string,
  opts: { stripPath?: boolean } = {},
): Promise<{ stdout: string; exit: number }> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
  };
  if (opts.stripPath) {
    // Force `Bun.which("codex")` to fail regardless of what's installed on
    // the host running these tests, so the "not available" branch is
    // deterministic without mocking the codex CLI itself.
    env.PATH = "";
  }
  // Absolute bun path: the stripped-PATH case would otherwise fail to spawn
  // the runner itself, not just the child's `Bun.which("codex")` probe.
  const proc = Bun.spawn([process.execPath, HOOK], {
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

async function seedVerdict(home: string, verdict: Record<string, unknown>): Promise<void> {
  const dir = join(home, ".claude", "tmp");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "codex-verdict.json"), JSON.stringify(verdict), "utf8");
}

describe("codex-verify.ts — default-on policy injection", () => {
  test("state 'available' (fresh cache) → emits additionalContext with codex:default-on", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codexverify-avail-"));
    try {
      await seedVerdict(home, {
        state: "available",
        checkedAt: new Date().toISOString(),
        sticky: false,
      });
      const { stdout, exit } = await runHook(home);
      expect(exit).toBe(0);
      expect(stdout).toContain("additionalContext");
      expect(stdout).toContain("codex:default-on");

      const parsed = JSON.parse(stdout.trim()) as HookOutput;
      expect(parsed.hookSpecificOutput?.hookEventName).toBe("SessionStart");
      expect(parsed.hookSpecificOutput?.additionalContext).toContain("codex:default-on");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("state not 'available' (not-installed, PATH stripped) → emits no additionalContext", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codexverify-noavail-"));
    try {
      const { stdout, exit } = await runHook(home, { stripPath: true });
      expect(exit).toBe(0);
      expect(stdout.trim()).toBe("");
      expect(stdout).not.toContain("codex:default-on");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
