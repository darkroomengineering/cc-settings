// Phase-1 gap proofs for session-continuity. Each test here failed on the
// pre-ledger tree and documents one concrete loss of continuity:
//
//   G1  A hook-triggered handoff (PreCompact/SessionEnd call `create` with no
//       args) leaves Session Summary as a placeholder comment — the compaction
//       summary Claude Code generates is never persisted anywhere.
//   G2  Key Files comes only from `git status --porcelain`, so a file edited
//       AND committed during the session is invisible in the handoff. The
//       longer the session, the more of its work disappears.
//   G3  post-compact.ts never reads stdin, so the official PostCompact payload
//       — including compact_summary — is discarded.
//
// These are kept as permanent regressions, not deleted once green: each one is
// a property that silently degrades if the ledger or the PostCompact wiring is
// later refactored away.

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const HANDOFF = resolve(import.meta.dir, "..", "src", "scripts", "handoff.ts");
const POST_COMPACT = resolve(import.meta.dir, "..", "src", "scripts", "post-compact.ts");

// Fixture repos must never inherit the developer/CI machine's ambient git
// config (commit.gpgsign + a signing program, core.hooksPath, aliases, ...).
// Nulling both config files is what actually isolates everything in one
// place; per-repo user.email/user.name (set below) remain the only identity
// available once the global/system files are gone.
const GIT_ISOLATION_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

async function git(repo: string, args: string[]): Promise<void> {
  await Bun.spawn(["git", "-C", repo, ...args], {
    env: { ...process.env, ...GIT_ISOLATION_ENV },
    stdout: "ignore",
    stderr: "ignore",
  }).exited;
}

/** Repo with one committed baseline file, so `git log` and `git status` both work. */
async function makeRepo(name: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `cc-gap-${name}-`));
  await Bun.spawn(["git", "init", "-q"], {
    cwd: repo,
    env: { ...process.env, ...GIT_ISOLATION_ENV },
  }).exited;
  await git(repo, ["config", "user.email", "t@example.com"]);
  await git(repo, ["config", "user.name", "Test"]);
  await writeFile(join(repo, "README.md"), "baseline\n");
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-q", "-m", "initial"]);
  return repo;
}

async function runScript(
  script: string,
  args: string[],
  cwd: string,
  home: string,
  stdin?: string,
): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd,
    env: { ...process.env, ...GIT_ISOLATION_ENV, HOME: home, USERPROFILE: home },
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin !== undefined && proc.stdin) {
    proc.stdin.write(stdin);
    proc.stdin.end();
  }
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

async function readHandoff(
  home: string,
  repo: string,
): Promise<{ json: Record<string, unknown>; md: string }> {
  const dir = join(home, ".claude", "handoffs", basename(repo));
  const json = JSON.parse(await readFile(join(dir, "latest.json"), "utf8"));
  const md = await readFile(join(dir, "latest.md"), "utf8");
  return { json, md };
}

describe("G1 — hook-triggered handoff carries the compaction summary", () => {
  test("a PreCompact-shaped invocation records session_id and trigger", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-gap-home-"));
    const repo = await makeRepo("g1");
    try {
      const payload = JSON.stringify({
        session_id: "sess-g1",
        trigger: "auto",
        cwd: repo,
        hook_event_name: "PreCompact",
      });
      const { exit } = await runScript(HANDOFF, ["create", "--from-hook"], repo, home, payload);
      expect(exit).toBe(0);

      const { json } = await readHandoff(home, repo);
      // Provenance is what lets PostCompact find THIS handoff later.
      expect(json.sessionId).toBe("sess-g1");
      expect(json.trigger).toBe("auto");
      expect(json.source).toBe("auto");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("G2 — files edited then committed survive in the handoff", () => {
  test("a committed file stays in Key Files even though git status no longer shows it", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-gap-home-"));
    const repo = await makeRepo("g2");
    try {
      // The session touches two files. One is committed (vanishes from git
      // status), one is left dirty (visible to git status).
      await writeFile(join(repo, "committed.ts"), "export const a = 1;\n");
      await writeFile(join(repo, "dirty.ts"), "export const b = 2;\n");
      await git(repo, ["add", "committed.ts"]);
      await git(repo, ["commit", "-q", "-m", "feat: add committed.ts"]);

      // The ledger is the only record that committed.ts was ever touched.
      const sessionId = "sess-g2";
      const ledgerDir = join(home, ".claude", "tmp", "session-ledger");
      await Bun.spawn(["mkdir", "-p", ledgerDir]).exited;
      const lines = [
        JSON.stringify({
          t: new Date().toISOString(),
          kind: "change",
          path: "committed.ts",
          tool: "Write",
        }),
        JSON.stringify({
          t: new Date().toISOString(),
          kind: "change",
          path: "dirty.ts",
          tool: "Edit",
        }),
      ].join("\n");
      await writeFile(join(ledgerDir, `${sessionId}.jsonl`), `${lines}\n`);

      const payload = JSON.stringify({ session_id: sessionId, cwd: repo });
      const { exit } = await runScript(HANDOFF, ["create", "--from-hook"], repo, home, payload);
      expect(exit).toBe(0);

      const { json, md } = await readHandoff(home, repo);
      const keyFiles = (json.context as { keyFiles: string[] }).keyFiles;

      // The whole point: git status alone would have dropped committed.ts.
      expect(keyFiles).toContain("committed.ts");
      expect(keyFiles).toContain("dirty.ts");
      expect(md).toContain("committed.ts");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("G3 — PostCompact persists the native compaction summary", () => {
  test("compact_summary backfills the handoff created by the preceding PreCompact", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-gap-home-"));
    const repo = await makeRepo("g3");
    try {
      const sessionId = "sess-g3";
      await runScript(
        HANDOFF,
        ["create", "--from-hook"],
        repo,
        home,
        JSON.stringify({ session_id: sessionId, trigger: "manual", cwd: repo }),
      );

      const before = await readHandoff(home, repo);
      expect((before.json.context as { summary: string }).summary).toBe("");

      const summary = "Refactored the auth guard; chose middleware over per-route checks.";
      const { exit } = await runScript(
        POST_COMPACT,
        [],
        repo,
        home,
        JSON.stringify({
          session_id: sessionId,
          hook_event_name: "PostCompact",
          trigger: "manual",
          compact_summary: summary,
          cwd: repo,
        }),
      );
      expect(exit).toBe(0);

      const after = await readHandoff(home, repo);
      expect((after.json.context as { summary: string }).summary).toBe(summary);
      expect(after.md).toContain(summary);
      // The placeholder must be gone, not merely appended to.
      expect(after.md).not.toContain("<!-- Add summary of what was accomplished -->");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });
});
