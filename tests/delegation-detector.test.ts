// Behavioral tests for delegation-detector.ts's scoring/steering path — see
// M25 in docs/audits/codebase-audit-2026-07-08.md. The blanket fail-open smoke
// test (hook-fail-open.test.ts) only feeds garbage input; these exercise the
// real scoring branches: breadth phrases, path-token count, list-item count,
// and the score < 2 allow threshold. The nudge text was later narrowed to report
// the signal without restating the delegation rule — see the last test.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnCapture } from "./support/proc.ts";

const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "delegation-detector.ts");

// An empty HOME so the host's own TypeSafe key (settings env) never reaches
// the regex-path tests; the Jev-path tests pass a key explicitly.
const HOME = await mkdtemp(join(tmpdir(), "delegation-detector-"));

async function runHook(
  prompt: string,
  env: Record<string, string | undefined> = {},
): Promise<{ stdout: string; exit: number }> {
  return spawnCapture(["bun", HOOK], {
    stdin: JSON.stringify({ prompt }),
    stderr: "ignore",
    env: { HOME, TYPESAFE_API_KEY: undefined, TYPESAFE_ENDPOINT: undefined, ...env },
  });
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

  // The hook reports the signal and defers to the heuristic in CLAUDE.md rather than
  // restating it — the rule is already in context, and repeating it at a second level
  // is the duplication Anthropic's Claude 5 context-engineering guidance warns against.
  test("nudge message reports the signal and defers to the heuristic, without restating it", async () => {
    const r = await runHook("Refactor the whole entire codebase now.");
    const ctx = additionalContext(r.stdout);
    expect(ctx).not.toBeNull();
    expect(ctx).toContain("Apply the delegation heuristic");
    expect(ctx).not.toContain("Agent(maestro)");
    expect(ctx).not.toContain("Overriding requires a one-line stated reason");
  });
});

// --- Jev path -------------------------------------------------------------
//
// A local stand-in for api.typesafe.ai: the probability it answers is chosen
// per request through the prompt text, so each test states its own case.

const jevServer = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as { state?: { user_prompt?: string } };
    const prompt = body.state?.user_prompt ?? "";
    if (prompt.includes("[hang]")) await Bun.sleep(3000);
    if (prompt.includes("[500]")) return new Response("boom", { status: 500 });
    const m = prompt.match(/\[p=([\d.]+)\]/);
    const noul = m ? Number(m[1]) : 0.05;
    return Response.json({ answers: { q: { noul } } });
  },
});
afterAll(() => jevServer.stop(true));

const JEV_ENV = { TYPESAFE_API_KEY: "test-key", TYPESAFE_ENDPOINT: jevServer.url.toString() };

describe("delegation-detector — Jev path", () => {
  test("Jev at or above 0.7 fires even when the regex is silent", async () => {
    const r = await runHook("Fix the build. [p=0.82]", JEV_ENV);
    expect(r.exit).toBe(0);
    const ctx = additionalContext(r.stdout);
    expect(ctx).toContain("Jev 0.82");
    expect(ctx).toContain("Jev delegation probability 0.82");
    expect(ctx).toContain("Apply the delegation heuristic");
  });

  test("Jev below 0.7 stays silent even when the regex would have fired", async () => {
    const r = await runHook("Please do everything on the backlog today. [p=0.31]", JEV_ENV);
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("a failing Jev call falls back to the regex score", async () => {
    const r = await runHook("Please do everything on the backlog today. [500]", JEV_ENV);
    expect(r.exit).toBe(0);
    const ctx = additionalContext(r.stdout);
    expect(ctx).toContain("score 2");
    expect(ctx).not.toContain("Jev");
  });

  test("a hanging Jev call times out and falls back to the regex score", async () => {
    const r = await runHook("Refactor the whole entire codebase now. [hang]", JEV_ENV);
    expect(r.exit).toBe(0);
    const ctx = additionalContext(r.stdout);
    expect(ctx).toContain("score 2");
  }, 10_000);

  test("the key is also read from the settings env block", async () => {
    const home = await mkdtemp(join(tmpdir(), "delegation-detector-settings-"));
    await Bun.write(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ env: { TYPESAFE_API_KEY: "settings-key" } }),
    );
    const r = await runHook("Fix the build. [p=0.9]", {
      HOME: home,
      TYPESAFE_ENDPOINT: jevServer.url.toString(),
    });
    expect(additionalContext(r.stdout)).toContain("Jev 0.90");
  });
});
