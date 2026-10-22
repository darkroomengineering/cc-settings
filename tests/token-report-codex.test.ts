// End-to-end check of the Codex section of `bun run tokens`: fixture rollouts in
// a temp CODEX_HOME, an empty temp Claude home, and token-report.ts in a child.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPORT = resolve(import.meta.dir, "../src/scripts/token-report.ts");

let dir: string;
let codexHome: string;
let claudeHome: string;
const project = "/work/repo";

function rollout(id: string, cwd: string, model: string, input: number): string {
  const usage = {
    input_tokens: input,
    cached_input_tokens: input / 2,
    cache_write_input_tokens: 0,
    output_tokens: 10,
    reasoning_output_tokens: 5,
    total_tokens: input + 10,
  };
  return [
    JSON.stringify({ type: "session_meta", payload: { id, cwd, source: "exec" } }),
    JSON.stringify({ type: "turn_context", payload: { turn_id: `${id}-t`, model } }),
    JSON.stringify({
      type: "token_usage_record",
      payload: { response_id: `${id}-r`, turn_id: `${id}-t`, usage },
    }),
  ].join("\n");
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cc-token-codex-"));
  codexHome = join(dir, "codex");
  claudeHome = join(dir, "claude");
  const day = join(codexHome, "sessions", "2026", "10", "21");
  await mkdir(day, { recursive: true });
  await mkdir(join(codexHome, "archived_sessions"), { recursive: true });
  await mkdir(join(claudeHome, "projects"), { recursive: true });
  await writeFile(join(day, "rollout-a.jsonl"), rollout("a", project, "gpt-6-astra", 100));
  await writeFile(join(day, "rollout-b.jsonl"), rollout("b", "/elsewhere", "gpt-6-luna", 300));
  const archived = join(codexHome, "archived_sessions", "rollout-c.jsonl");
  await writeFile(archived, rollout("c", project, "gpt-6-astra", 1000));
  const old = new Date(Date.now() - 30 * 86_400_000);
  await utimes(archived, old, old);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function report(args: string[], env: Record<string, string | undefined>) {
  const proc = Bun.spawn([process.execPath, REPORT, ...args], {
    env: { ...process.env, CC_SETTINGS_HOME: claudeHome, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`token-report exited ${code}: ${stderr}`);
  return stdout;
}

describe("token-report Codex section", () => {
  test("--project keeps rollouts started in that directory, live and archived", async () => {
    const out = JSON.parse(
      await report(["--project", project, "--json"], { CODEX_HOME: codexHome }),
    );
    expect(out.codex.sessions).toEqual({ main: 2, subagent: 0 });
    expect(out.codex.tokens.main.input).toBe(1100);
    expect(Object.keys(out.codex.byModel)).toEqual(["gpt-6-astra"]);
    expect(out.codex.cost).toBeNull();
  });

  test("--days drops rollouts modified before the window; --all spans every cwd", async () => {
    const out = JSON.parse(
      await report(["--all", "--days", "7", "--json"], { CODEX_HOME: codexHome }),
    );
    expect(out.codex.sessions.main).toBe(2);
    expect(out.codex.tokens.main.input).toBe(400);
  });

  test("text output labels Codex as tokens only", async () => {
    const out = await report(["--all"], { CODEX_HOME: codexHome });
    expect(out).toContain("Codex: 3 sessions (0 subagent), tokens only: cost n/a");
    expect(out).toContain("gpt-6-astra");
  });

  test("no Codex home: no Codex section", async () => {
    const missing = join(dir, "no-codex");
    const json = JSON.parse(await report(["--all", "--json"], { CODEX_HOME: missing }));
    expect(json).not.toHaveProperty("codex");
    const text = await report(["--all"], { CODEX_HOME: missing });
    expect(text).not.toContain("Codex");
  });
});
