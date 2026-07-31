// Regression suite for the session-continuity feature: the session ledger
// (src/lib/session-ledger.ts) plus its three consumers — ledger-record.ts
// (writes), handoff.ts (reads into a handoff), post-compact.ts (backfills the
// model's own compaction summary), session-start.ts (re-injects a bounded
// digest on a compact restart).
//
// Organized by Factory's four continuity probes, plus a fifth for edge cases:
//   Recall        — compact_summary lands on the RIGHT handoff, and only that one.
//   Artifact      — reads/changes are tracked as distinct, deduped, bounded sets.
//   Continuation  — SessionStart(source:compact) re-surfaces the trail, capped.
//   Decision      — compact_summary carries intent verbatim; the ledger never does.
//   Robustness    — caps, corruption, unsafe ids, secrets, repeated compaction.
//
// This file does NOT duplicate tests/context-continuity-gaps.test.ts (G1-G3),
// which documents the original pre-ledger gaps as permanent regressions.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  appendEntries,
  EMPTY_DIGEST,
  entryForToolCall,
  failureEntry,
  isSafeSessionId,
  type LedgerEntry,
  ledgerPath,
  MAX_CHANGES,
  MAX_ERROR_CHARS,
  MAX_FAILURES,
  pathFromToolInput,
  readDigest,
  toProjectRelative,
} from "../src/lib/session-ledger.ts";

const HANDOFF = resolve(import.meta.dir, "..", "src", "scripts", "handoff.ts");
const POST_COMPACT = resolve(import.meta.dir, "..", "src", "scripts", "post-compact.ts");
const SESSION_START = resolve(import.meta.dir, "..", "src", "scripts", "session-start.ts");

// --- Shared helpers ---------------------------------------------------------

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

/** Repo with one committed baseline file, so `git log` / `git status` both work. */
async function makeRepo(name: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `cc-cont-${name}-`));
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

function handoffDirFor(home: string, repo: string): string {
  return join(home, ".claude", "handoffs", basename(repo));
}

/** replaceMarkdownSection is exported by post-compact.ts, which also runs a
 *  hook-shaped `await runHook(...)` at module top level that reads
 *  Bun.stdin.text(). Importing that module directly from the test process
 *  would tie the import's completion to the TEST RUNNER's own stdin — a real
 *  hang risk when `bun test` is run at an interactive terminal. Instead, spawn
 *  a throwaway harness process with stdin explicitly "ignore" (child stdin is
 *  /dev/null, so the top-level read resolves to "" immediately and the hook's
 *  early-return fires), import the module there, and hand back only the pure
 *  function's result. */
async function callReplaceMarkdownSection(
  md: string,
  heading: string,
  body: string,
): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "cc-rms-"));
  try {
    const harnessPath = join(dir, "harness.mjs");
    const inputPath = join(dir, "input.json");
    const outputPath = join(dir, "output.json");
    await writeFile(
      harnessPath,
      [
        'import { pathToFileURL } from "node:url";',
        'import { readFile, writeFile } from "node:fs/promises";',
        "const [postCompactPath, inputPath, outputPath] = process.argv.slice(2);",
        "const { replaceMarkdownSection } = await import(pathToFileURL(postCompactPath).href);",
        'const { md, heading, body } = JSON.parse(await readFile(inputPath, "utf8"));',
        "const result = replaceMarkdownSection(md, heading, body);",
        "await writeFile(outputPath, JSON.stringify({ result }));",
      ].join("\n"),
    );
    await writeFile(inputPath, JSON.stringify({ md, heading, body }));
    const proc = Bun.spawn(["bun", harnessPath, POST_COMPACT, inputPath, outputPath], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    const exit = await proc.exited;
    if (exit !== 0) {
      const err = await new Response(proc.stderr).text();
      throw new Error(`replaceMarkdownSection harness failed (exit ${exit}): ${err}`);
    }
    const parsed = JSON.parse(await readFile(outputPath, "utf8")) as { result: string | null };
    return parsed.result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function isEntry(e: LedgerEntry | null): e is LedgerEntry {
  return e !== null;
}

// --- Recall ------------------------------------------------------------------

describe("Recall — compaction backfills only the handoff for its own session", () => {
  test("compact_summary updates the matching sessionId's handoff and leaves a different session's handoff untouched", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-recall-home-"));
    const repo = await makeRepo("recall");
    try {
      const sessA = "sess-recall-a";
      const sessB = "sess-recall-b";
      const dir = handoffDirFor(home, repo);

      const createA = await runScript(
        HANDOFF,
        ["create", "--from-hook"],
        repo,
        home,
        JSON.stringify({ session_id: sessA, trigger: "auto", cwd: repo }),
      );
      expect(createA.exit).toBe(0);
      const jsonPathA = /JSON:\s+(\S+)/.exec(createA.stdout)?.[1];
      expect(jsonPathA).toBeTruthy();

      // Handoff B is written directly rather than via a second `create` call:
      // handoff.ts's filename timestamp is second-granular, so two `create`
      // calls this close together (well under the 5s cooldown too) can collide
      // on the same filename. post-compact.ts's candidate scan reads every
      // handoff_*.json in the directory regardless of the `latest` symlink, so
      // a hand-written second file exercises the sessionId-matching logic
      // exactly the same way a real second create would.
      const jsonPathB = join(dir, "handoff_manual-b.json");
      await mkdir(dir, { recursive: true });
      await writeFile(
        jsonPathB,
        `${JSON.stringify(
          {
            timestamp: "2020-01-01T00:00:00Z",
            context: { summary: "", activeTodos: [], keyFiles: [], currentTask: "" },
            sessionId: sessB,
            trigger: "auto",
            source: "auto",
          },
          null,
          2,
        )}\n`,
      );

      const summary = "Refactored the auth guard; chose middleware over per-route checks.";
      const pc = await runScript(
        POST_COMPACT,
        [],
        repo,
        home,
        JSON.stringify({
          session_id: sessA,
          cwd: repo,
          trigger: "manual",
          compact_summary: summary,
        }),
      );
      expect(pc.exit).toBe(0);

      const recordA = JSON.parse(await readFile(jsonPathA as string, "utf8")) as {
        context: { summary: string };
        compactedAt?: string;
      };
      const recordB = JSON.parse(await readFile(jsonPathB as string, "utf8")) as {
        context: { summary: string };
        compactedAt?: string;
      };

      expect(recordA.context.summary).toBe(summary);
      expect(typeof recordA.compactedAt).toBe("string");

      // The whole point: a compaction in session A must never leak into B's handoff.
      expect(recordB.context.summary).toBe("");
      expect(recordB.compactedAt).toBeUndefined();
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });
});

// --- Artifact ------------------------------------------------------------------

describe("Artifact — reads and changes are tracked as distinct, deduped sets", () => {
  test("readDigest dedupes repeated reads/changes and keeps a path that was both read and changed in both lists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-ledger-"));
    try {
      const sessionId = "sess-artifact-dedupe";
      const now = "2026-01-01T00:00:00Z";
      await appendEntries(
        sessionId,
        [
          { t: now, kind: "read", path: "/repo/a.ts", tool: "Read" },
          { t: now, kind: "read", path: "/repo/a.ts", tool: "Read" }, // duplicate read of the same file
          { t: now, kind: "change", path: "/repo/a.ts", tool: "Edit" }, // same path, also changed
          { t: now, kind: "read", path: "/repo/b.ts", tool: "Read" },
        ],
        dir,
      );

      const digest = await readDigest(sessionId, dir);

      // Dedup: two reads of a.ts collapse into one.
      expect(digest.reads).toEqual(["/repo/a.ts", "/repo/b.ts"]);
      // Distinct lists: b.ts was only ever read, never changed.
      expect(digest.changes).toEqual(["/repo/a.ts"]);
      // A file that was both read and changed appears in BOTH lists.
      expect(digest.reads).toContain("/repo/a.ts");
      expect(digest.changes).toContain("/repo/a.ts");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a file edited then committed survives in the handoff's keyFiles/filesModified, distinct from filesRead", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-art-home-"));
    const repo = await makeRepo("artifact");
    try {
      await writeFile(join(repo, "committed.ts"), "export const a = 1;\n");
      await writeFile(join(repo, "read-only.ts"), "export const b = 2;\n");
      await git(repo, ["add", "committed.ts", "read-only.ts"]);
      await git(repo, ["commit", "-q", "-m", "feat: add committed and read-only files"]);

      const sessionId = "sess-artifact-b";
      const ledgerDir = join(home, ".claude", "tmp", "session-ledger");
      await mkdir(ledgerDir, { recursive: true });
      const now = new Date().toISOString();
      const lines = [
        JSON.stringify({ t: now, kind: "change", path: "committed.ts", tool: "Write" }),
        JSON.stringify({ t: now, kind: "read", path: "read-only.ts", tool: "Read" }),
      ];
      await writeFile(join(ledgerDir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`);

      const { exit } = await runScript(
        HANDOFF,
        ["create", "--from-hook"],
        repo,
        home,
        JSON.stringify({ session_id: sessionId, cwd: repo }),
      );
      expect(exit).toBe(0);

      const dir = handoffDirFor(home, repo);
      const json = JSON.parse(await readFile(join(dir, "latest.json"), "utf8")) as {
        context: { keyFiles: string[] };
        artifacts: { filesModified: string[]; filesRead: string[] };
      };

      // git status alone would have forgotten committed.ts — the ledger is what
      // keeps it visible in the handoff.
      expect(json.context.keyFiles).toContain("committed.ts");
      expect(json.artifacts.filesModified).toContain("committed.ts");
      expect(json.artifacts.filesModified).not.toContain("read-only.ts");
      expect(json.artifacts.filesRead).toContain("read-only.ts");
      expect(json.artifacts.filesRead).not.toContain("committed.ts");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });
});

// --- Continuation ------------------------------------------------------------------

describe("Continuation — SessionStart(source:compact) surfaces the artifact trail, capped", () => {
  test("compact start emits the handoff path, an 8-file-capped digest, and only the last failure, in <=15 total lines", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-cont-home-"));
    const repo = await makeRepo("cont-compact");
    try {
      const sessionId = "sess-cont-a";
      const ledgerDir = join(home, ".claude", "tmp", "session-ledger");
      await mkdir(ledgerDir, { recursive: true });
      const now = new Date().toISOString();
      const lines: string[] = [];
      for (let i = 1; i <= 12; i++) {
        lines.push(
          JSON.stringify({
            t: now,
            kind: "change",
            path: `file${String(i).padStart(2, "0")}.ts`,
            tool: "Write",
          }),
        );
      }
      lines.push(
        JSON.stringify({
          t: now,
          kind: "failure",
          tool: "Bash",
          error: "first failure — must not show",
        }),
      );
      lines.push(
        JSON.stringify({
          t: now,
          kind: "failure",
          tool: "Bash",
          error: "LAST failure — this one shows",
        }),
      );
      await writeFile(join(ledgerDir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`);

      const dir = handoffDirFor(home, repo);
      await mkdir(dir, { recursive: true });
      const latestMd = join(dir, "latest.md");
      await writeFile(latestMd, "# Session Handoff\n");

      const { stdout, exit } = await runScript(
        SESSION_START,
        [],
        repo,
        home,
        JSON.stringify({ session_id: sessionId, source: "compact" }),
      );
      expect(exit).toBe(0);

      const outLines = stdout.split("\n");
      // "Auto-memory: ..." is printed unconditionally right after an unconditional
      // blank line — everything strictly before that pair is the compact block.
      const markerIndex = outLines.findIndex((l) => l.startsWith("Auto-memory: say 'remember X'"));
      expect(markerIndex).toBeGreaterThan(0);
      const compactBlock = outLines.slice(0, markerIndex - 1);

      expect(compactBlock.length).toBeLessThanOrEqual(15);

      const blockText = compactBlock.join("\n");
      expect(blockText).toContain("[compact] Context was compacted");
      expect(blockText).toContain(`[compact] Full handoff: ${latestMd}`);
      expect(blockText).toContain("[compact] Files this session changed (8 of 12):");
      // Only the newest 8 of 12 changed files are shown.
      expect(blockText).toContain("file05.ts");
      expect(blockText).toContain("file12.ts");
      expect(blockText).not.toContain("file01.ts");
      expect(blockText).not.toContain("file04.ts");
      // Only the LAST failure is surfaced, not an earlier one.
      expect(blockText).toContain("LAST failure — this one shows");
      expect(blockText).not.toContain("first failure — must not show");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("a non-compact start (source:startup) emits no [compact] lines at all", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-cont-home-"));
    const repo = await makeRepo("cont-startup");
    try {
      const { stdout, exit } = await runScript(
        SESSION_START,
        [],
        repo,
        home,
        JSON.stringify({ session_id: "sess-cont-b", source: "startup" }),
      );
      expect(exit).toBe(0);
      expect(stdout).not.toContain("[compact]");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });
});

// --- Decision ------------------------------------------------------------------

describe("Decision — compact_summary carries intent verbatim; the ledger never does", () => {
  test("a decision + rationale summary survives into the handoff exactly, and a sibling section stays untouched", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-dec-home-"));
    const repo = await makeRepo("decision");
    try {
      const sessionId = "sess-decision";
      const create = await runScript(
        HANDOFF,
        ["create", "--from-hook"],
        repo,
        home,
        JSON.stringify({ session_id: sessionId, trigger: "auto", cwd: repo }),
      );
      expect(create.exit).toBe(0);

      const dir = handoffDirFor(home, repo);
      const mdBefore = await readFile(join(dir, "latest.md"), "utf8");
      const projectSectionMatch = /## Project\n[\s\S]*?\n## /.exec(mdBefore);
      expect(projectSectionMatch).not.toBeNull();
      const projectSection = (projectSectionMatch as RegExpExecArray)[0];

      const summary =
        "Decision: switched the session ledger to JSONL over SQLite.\n" +
        "Rationale: SQLite needs a native binding per platform; a corrupt JSONL line only costs that one line, not the whole store.\n" +
        'Next: cap reads/changes separately so a read-heavy turn can\'t crowd out the rarer "what changed" record.';

      const pc = await runScript(
        POST_COMPACT,
        [],
        repo,
        home,
        JSON.stringify({
          session_id: sessionId,
          cwd: repo,
          trigger: "auto",
          compact_summary: summary,
        }),
      );
      expect(pc.exit).toBe(0);

      const jsonAfter = JSON.parse(await readFile(join(dir, "latest.json"), "utf8")) as {
        context: { summary: string };
      };
      // Exact equality — no paraphrase, no truncation.
      expect(jsonAfter.context.summary).toBe(summary);

      const mdAfter = await readFile(join(dir, "latest.md"), "utf8");
      expect(mdAfter).toContain(summary);
      // The Project section is byte-identical to before compaction.
      expect(mdAfter).toContain(projectSection);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("a digest built from Read/Write entries alone carries only paths/tools/errors — no prose field, empty failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-ledger-"));
    try {
      const sessionId = "sess-decision-purity";
      const now = "2026-01-01T00:00:00Z";
      const entries = [
        entryForToolCall({ tool_name: "Read", tool_input: { file_path: "a.ts" } }, now, "/repo"),
        entryForToolCall({ tool_name: "Write", tool_input: { file_path: "b.ts" } }, now, "/repo"),
      ].filter(isEntry);
      await appendEntries(sessionId, entries, dir);

      const digest = await readDigest(sessionId, dir);
      // The digest's shape has no room for a decision/summary field — only
      // observed metadata.
      expect(Object.keys(digest).sort()).toEqual(["changes", "failures", "reads"]);
      expect(digest.failures).toEqual([]);
      expect(digest.reads).toEqual([resolve("/repo", "a.ts")]);
      expect(digest.changes).toEqual([resolve("/repo", "b.ts")]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// --- Robustness ------------------------------------------------------------------

describe("Robustness", () => {
  test("isSafeSessionId accepts bounded alnum/dot/dash/underscore ids and rejects traversal, leading dot, and non-strings", () => {
    expect(isSafeSessionId("abc123")).toBe(true);
    expect(isSafeSessionId("a.b-c_d")).toBe(true);
    expect(isSafeSessionId("a".repeat(128))).toBe(true);
    expect(isSafeSessionId("a".repeat(129))).toBe(false);
    expect(isSafeSessionId("")).toBe(false);
    expect(isSafeSessionId(".hidden")).toBe(false);
    expect(isSafeSessionId("a/b")).toBe(false);
    expect(isSafeSessionId("../x")).toBe(false);
    expect(isSafeSessionId(42)).toBe(false);
    expect(isSafeSessionId(null)).toBe(false);
    expect(isSafeSessionId(undefined)).toBe(false);
  });

  test("appendEntries is a silent no-op for an unsafe or missing session id — no throw, no file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-ledger-"));
    try {
      const entry = entryForToolCall(
        { tool_name: "Write", tool_input: { file_path: "/x.ts" } },
        "t",
      );
      expect(entry).not.toBeNull();
      // Neither call may throw.
      await appendEntries("../evil", [entry as LedgerEntry], dir);
      await appendEntries(undefined, [entry as LedgerEntry], dir);
      await appendEntries(".hidden", [entry as LedgerEntry], dir);

      const files = await readdir(dir).catch(() => []);
      expect(files).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("readDigest returns EMPTY_DIGEST for a missing ledger file, without throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-ledger-"));
    try {
      const digest = await readDigest("sess-missing", dir);
      expect(digest).toEqual(EMPTY_DIGEST);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("readDigest skips corrupt or partial JSONL lines individually and keeps the valid ones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-ledger-"));
    try {
      const sessionId = "sess-corrupt";
      await mkdir(dir, { recursive: true });
      const lines = [
        JSON.stringify({ t: "t1", kind: "read", path: "/repo/good1.ts", tool: "Read" }),
        '{"t":"t2","kind":"change","path":"/repo/trunc', // truncated mid-write, no closing brace
        "not json at all",
        JSON.stringify({ t: "t3", kind: "change", path: "/repo/good2.ts", tool: "Write" }),
      ];
      await writeFile(ledgerPath(sessionId, dir), `${lines.join("\n")}\n`);

      const digest = await readDigest(sessionId, dir);
      expect(digest.reads).toEqual(["/repo/good1.ts"]);
      expect(digest.changes).toEqual(["/repo/good2.ts"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("readDigest dedupe keeps last-wins order, ascending by recency", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-ledger-"));
    try {
      const sessionId = "sess-order";
      const now = "2026-01-01T00:00:00Z";
      // a.ts is touched first and last; b.ts only in between — a.ts's most
      // recent touch is AFTER b.ts's only touch, so a.ts sorts last.
      await appendEntries(
        sessionId,
        [
          { t: now, kind: "read", path: "/repo/a.ts", tool: "Read" },
          { t: now, kind: "read", path: "/repo/b.ts", tool: "Read" },
          { t: now, kind: "read", path: "/repo/a.ts", tool: "Read" },
        ],
        dir,
      );
      const digest = await readDigest(sessionId, dir);
      expect(digest.reads).toEqual(["/repo/b.ts", "/repo/a.ts"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("readDigest caps changes at MAX_CHANGES (keeping the newest) and failures at the last MAX_FAILURES", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-ledger-"));
    try {
      const sessionId = "sess-caps";
      const now = "2026-01-01T00:00:00Z";

      const totalChanges = MAX_CHANGES + 10;
      const changeEntries: LedgerEntry[] = Array.from({ length: totalChanges }, (_, i) => ({
        t: now,
        kind: "change",
        path: `/repo/change-${String(i + 1).padStart(3, "0")}.ts`,
        tool: "Write",
      }));

      const totalFailures = MAX_FAILURES + 5;
      const failureEntries: LedgerEntry[] = Array.from({ length: totalFailures }, (_, i) => ({
        t: now,
        kind: "failure",
        tool: `Tool${i + 1}`,
        error: `failure #${i + 1}`,
      }));

      await appendEntries(sessionId, [...changeEntries, ...failureEntries], dir);
      const digest = await readDigest(sessionId, dir);

      expect(digest.changes).toHaveLength(MAX_CHANGES);
      const firstKept = totalChanges - MAX_CHANGES + 1;
      expect(digest.changes[0]).toBe(`/repo/change-${String(firstKept).padStart(3, "0")}.ts`);
      expect(digest.changes.at(-1)).toBe(
        `/repo/change-${String(totalChanges).padStart(3, "0")}.ts`,
      );

      // Failures are NOT deduped — the cap keeps the LAST MAX_FAILURES, in order.
      expect(digest.failures).toHaveLength(MAX_FAILURES);
      const firstFailureKept = totalFailures - MAX_FAILURES + 1;
      expect(digest.failures[0]?.tool).toBe(`Tool${firstFailureKept}`);
      expect(digest.failures.at(-1)?.tool).toBe(`Tool${totalFailures}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("failureEntry redacts secrets and truncates to MAX_ERROR_CHARS with a single trailing ellipsis", () => {
    const secret = "sk-ant-api03-FAKEFAKEFAKE";
    const long = `boom: ${secret} ${"x".repeat(400)}`;
    const entry = failureEntry("Bash", long, "2026-01-01T00:00:00Z");
    if (entry.kind !== "failure") throw new Error("expected a failure entry");

    expect(entry.error).not.toContain("FAKEFAKEFAKE");
    expect(entry.error).not.toContain(secret);
    expect(entry.error.length).toBe(MAX_ERROR_CHARS + 1); // +1 for the trailing ellipsis char
    expect(entry.error.endsWith("…")).toBe(true);
    expect(entry.error.match(/…/g)?.length).toBe(1);

    const short = failureEntry("Bash", "quick error", "t");
    if (short.kind !== "failure") throw new Error("expected a failure entry");
    expect(short.error).toBe("quick error");
    expect(short.error.endsWith("…")).toBe(false);
  });

  test("toProjectRelative relativizes paths under root and leaves an outside-root path absolute", () => {
    const root = "/repo/project";
    const result = toProjectRelative(
      ["/repo/project/src/a.ts", "/repo/project/nested/b.ts", "/etc/outside.ts"],
      root,
    );
    // Outside root must stay absolute rather than becoming a "../../etc/..." string.
    expect(result).toEqual(["src/a.ts", "nested/b.ts", "/etc/outside.ts"]);
  });

  test("pathFromToolInput reads notebook_path for NotebookEdit, file_path otherwise, and rejects empty/non-string paths", () => {
    expect(pathFromToolInput("NotebookEdit", { notebook_path: "/a.ipynb" })).toBe("/a.ipynb");
    expect(pathFromToolInput("Edit", { file_path: "/a.ts" })).toBe("/a.ts");
    expect(pathFromToolInput("Edit", { file_path: "   " })).toBeNull();
    expect(pathFromToolInput("Edit", {})).toBeNull();
    expect(pathFromToolInput("Edit", null)).toBeNull();
    // NotebookEdit only reads notebook_path — a stray file_path must not leak through.
    expect(pathFromToolInput("NotebookEdit", { file_path: "/wrong-field.ts" })).toBeNull();
  });

  test("entryForToolCall returns null for untracked tools (Bash) and for calls missing a path field", () => {
    expect(entryForToolCall({ tool_name: "Bash", tool_input: { command: "ls" } }, "t")).toBeNull();
    expect(entryForToolCall({ tool_name: "Read", tool_input: {} }, "t")).toBeNull();
    expect(entryForToolCall({ tool_name: "", tool_input: { file_path: "/a.ts" } }, "t")).toBeNull();
    expect(entryForToolCall({}, "t")).toBeNull();
  });

  test("entryForToolCall resolves a relative path against cwd and leaves an absolute path unchanged", () => {
    // `path` only exists on the read/change variants — narrow before reading it
    // rather than asserting the union has a field the failure variant lacks.
    const pathOf = (e: LedgerEntry | null): string | null =>
      e && e.kind !== "failure" ? e.path : null;

    const rel = entryForToolCall(
      { tool_name: "Write", tool_input: { file_path: "src/a.ts" } },
      "t",
      "/repo/sub",
    );
    expect(pathOf(rel)).toBe(resolve("/repo/sub", "src/a.ts"));

    const abs = entryForToolCall(
      { tool_name: "Write", tool_input: { file_path: "/already/abs.ts" } },
      "t",
      "/repo/sub",
    );
    expect(pathOf(abs)).toBe("/already/abs.ts");
  });

  test("entryForToolCall and the JSONL it produces never carry tool_response content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-ledger-"));
    try {
      const sentinel = "SENTINEL_FILE_CONTENTS_MUST_NEVER_PERSIST_9f3a";
      const call = {
        tool_name: "Read",
        tool_input: { file_path: "/repo/secret.ts" },
        tool_response: { content: sentinel, other: sentinel },
      };
      const entry = entryForToolCall(call, "2026-01-01T00:00:00Z", "/repo");
      expect(entry).not.toBeNull();
      expect(JSON.stringify(entry)).not.toContain(sentinel);

      const sessionId = "sess-sentinel";
      await appendEntries(sessionId, [entry as LedgerEntry], dir);
      const raw = await readFile(ledgerPath(sessionId, dir), "utf8");
      expect(raw).not.toContain(sentinel);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("one entryForToolCall sweep over a parallel tool-call batch records reads/changes and ignores Bash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-ledger-"));
    try {
      const sessionId = "sess-batch";
      const now = "2026-01-01T00:00:00Z";
      const cwd = "/repo";
      // Simulates ONE PostToolBatch payload: several tool calls fired by one turn.
      const batch = [
        { tool_name: "Read", tool_input: { file_path: "a.ts" } },
        { tool_name: "Read", tool_input: { file_path: "b.ts" } },
        { tool_name: "Write", tool_input: { file_path: "c.ts" } },
        { tool_name: "Bash", tool_input: { command: "ls" } },
        { tool_name: "Edit", tool_input: { file_path: "d.ts" } },
      ];
      const entries = batch.map((call) => entryForToolCall(call, now, cwd)).filter(isEntry);

      expect(entries).toHaveLength(4); // Bash never produces an entry

      await appendEntries(sessionId, entries, dir);
      const digest = await readDigest(sessionId, dir);
      expect([...digest.reads].sort()).toEqual([resolve(cwd, "a.ts"), resolve(cwd, "b.ts")].sort());
      expect([...digest.changes].sort()).toEqual(
        [resolve(cwd, "c.ts"), resolve(cwd, "d.ts")].sort(),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("two compaction cycles in one session: the second summary overwrites the first on the same handoff", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-twocompact-home-"));
    const repo = await makeRepo("twocompact");
    try {
      const sessionId = "sess-two-cycles";
      await runScript(
        HANDOFF,
        ["create", "--from-hook"],
        repo,
        home,
        JSON.stringify({ session_id: sessionId, trigger: "auto", cwd: repo }),
      );

      const dir = handoffDirFor(home, repo);
      const first = "first pass: chose X because Y";
      const second = "final: switched to Z because W";

      const pc1 = await runScript(
        POST_COMPACT,
        [],
        repo,
        home,
        JSON.stringify({
          session_id: sessionId,
          cwd: repo,
          trigger: "auto",
          compact_summary: first,
        }),
      );
      expect(pc1.exit).toBe(0);

      const pc2 = await runScript(
        POST_COMPACT,
        [],
        repo,
        home,
        JSON.stringify({
          session_id: sessionId,
          cwd: repo,
          trigger: "auto",
          compact_summary: second,
        }),
      );
      expect(pc2.exit).toBe(0);

      const json = JSON.parse(await readFile(join(dir, "latest.json"), "utf8")) as {
        context: { summary: string };
      };
      expect(json.context.summary).toBe(second);

      const md = await readFile(join(dir, "latest.md"), "utf8");
      expect(md).toContain(second);
      expect(md).not.toContain(first);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("an old handoff record without a sessionId field is left byte-identical by post-compact", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-legacy-home-"));
    const repo = await makeRepo("legacy-handoff");
    try {
      const dir = handoffDirFor(home, repo);
      await mkdir(dir, { recursive: true });
      const jsonPath = join(dir, "handoff_legacy.json");
      const mdPath = join(dir, "handoff_legacy.md");
      // No `sessionId` field at all — as a pre-provenance handoff would look.
      const originalJson = `${JSON.stringify(
        { timestamp: "2020-01-01T00:00:00Z", context: { summary: "" } },
        null,
        2,
      )}\n`;
      const originalMd =
        "# Session Handoff - legacy\n\n## Session Summary\nold\n\n## Other\nkeep\n";
      await writeFile(jsonPath, originalJson);
      await writeFile(mdPath, originalMd);

      const { exit } = await runScript(
        POST_COMPACT,
        [],
        repo,
        home,
        JSON.stringify({
          session_id: "sess-should-not-match",
          cwd: repo,
          trigger: "manual",
          compact_summary: "should not land here",
        }),
      );
      expect(exit).toBe(0);

      expect(await readFile(jsonPath, "utf8")).toBe(originalJson);
      expect(await readFile(mdPath, "utf8")).toBe(originalMd);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("replaceMarkdownSection replaces only the target section's body, leaving sibling sections byte-identical", async () => {
    const md =
      "# Title\n\n## Project\n- keep this\n\n## Session Summary\nold summary\n\n## Notes\nkeep that too\n";
    const result = await callReplaceMarkdownSection(md, "Session Summary", "new summary text");
    expect(result).not.toBeNull();
    expect(result).toContain("new summary text");
    expect(result).not.toContain("old summary");
    expect(result).toContain("## Project\n- keep this");
    expect(result).toContain("## Notes\nkeep that too");
  });

  test("replaceMarkdownSection returns null when the heading is absent", async () => {
    const md = "# Title\n\n## Something Else\ncontent\n";
    const result = await callReplaceMarkdownSection(md, "Session Summary", "new");
    expect(result).toBeNull();
  });

  test("replaceMarkdownSection replaces a trailing section that has no following heading", async () => {
    const md = "# Title\n\n## Session Summary\nold\n";
    const result = await callReplaceMarkdownSection(md, "Session Summary", "new");
    expect(result).toBe("# Title\n\n## Session Summary\nnew");
  });
});
