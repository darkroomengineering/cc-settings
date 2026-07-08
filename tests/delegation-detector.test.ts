// Behavioral tests for delegation-detector.ts's scoring/steering path — see
// M25 in docs/audits/codebase-audit-2026-07-08.md. The blanket fail-open smoke
// test (hook-fail-open.test.ts) only feeds garbage input; these exercise the
// real scoring branches: breadth phrases, path-token count, list-item count,
// and the score < 2 allow threshold. delegation-detector.ts is read-only here
// (no changes made to it) — this file only adds coverage.

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "delegation-detector.ts");

async function runHook(prompt: string): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", HOOK], {
    env: { ...process.env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.write(JSON.stringify({ prompt }));
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

function additionalContext(stdout: string): string | null {
  if (!stdout) return null;
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput?: { additionalContext?: string };
  };
  return parsed.hookSpecificOutput?.additionalContext ?? null;
}

describe("delegation-detector — scoring paths", () => {
  test("allow: empty prompt → silent exit 0", async () => {
    const r = await runHook("");
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("allow: plain low-signal prompt (score 0) → silent exit 0", async () => {
    const r = await runHook("What does this function return?");
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("allow: single weak signal alone (score 1, below threshold) → silent", async () => {
    // Three path-shaped tokens only (no breadth phrase, no list items) → score 1.
    const r = await runHook("Look at src/foo.ts and lib/bar.ts and app/baz.ts please.");
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("nudge: a breadth phrase alone reaches the threshold (score 2)", async () => {
    const r = await runHook("Please do everything on the backlog today.");
    expect(r.exit).toBe(0);
    const ctx = additionalContext(r.stdout);
    expect(ctx).not.toBeNull();
    expect(ctx).toContain("Breadth signals");
    expect(ctx).toContain("Agent(maestro)");
    expect(ctx).toContain('breadth phrase matched: "do everything"');
  });

  test("nudge: two weak signals combine to reach the threshold (path tokens + list items)", async () => {
    const prompt = ["Update these:", "- src/a.ts", "- lib/b.ts", "- app/c.ts", "- app/d.ts"].join(
      "\n",
    );
    const r = await runHook(prompt);
    expect(r.exit).toBe(0);
    const ctx = additionalContext(r.stdout);
    expect(ctx).not.toBeNull();
    expect(ctx).toContain("path-shaped tokens found");
    expect(ctx).toContain("list items found");
  });

  test("nudge message cites the CLAUDE.md delegation heuristic and requires a stated override", async () => {
    const r = await runHook("Refactor the whole entire codebase now.");
    const ctx = additionalContext(r.stdout);
    expect(ctx).not.toBeNull();
    expect(ctx).toContain("Overriding requires a one-line stated reason");
  });
});
