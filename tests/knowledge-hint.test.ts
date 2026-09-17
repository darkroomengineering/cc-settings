// Tests for the knowledge-hint ranking logic (src/lib/knowledge-hint.ts) and
// one end-to-end spawn test of the hook (src/hooks/knowledge-hint.ts), HOME
// sandboxed per tests/freeze.test.ts's pattern.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GENERIC_TOKENS, rankNotes, scoreNote, tokensFor } from "../src/lib/knowledge-hint.ts";
import type { KnowledgeIndex, KnowledgeNote } from "../src/lib/knowledge-index.ts";

const DRIZZLE: KnowledgeNote = {
  name: "drizzle-push-sqlite-not-null-column-truncates",
  kind: "gotcha",
  tags: ["drizzle", "sqlite", "turso", "migrations", "production"],
  hook: "drizzle-kit push against prod truncated a not-null column.",
};

const TESTFLIGHT: KnowledgeNote = {
  name: "testflight-beta-versioning-and-eas-distribution",
  kind: "convention",
  tags: ["ios", "testflight", "expo", "eas", "release"],
  hook: "TestFlight treats the marketing version as the unit of Beta App Review.",
};

const NEXT_DEV: KnowledgeNote = {
  name: "next-16-3-dev-writes-agents-md",
  kind: "gotcha",
  tags: ["nextjs", "agents", "dev-server"],
  hook: "next dev writes an AGENTS.md at startup.",
};

const LIGHTHOUSE: KnowledgeNote = {
  name: "webgl-software-renderer-hangs-lighthouse",
  kind: "gotcha",
  tags: ["webgl", "lighthouse", "pagespeed", "performance"],
  hook: "A software WebGL renderer hangs Lighthouse audits.",
};

const API_ERROR: KnowledgeNote = {
  name: "api-routes-data-error-shape",
  kind: "convention",
  tags: ["api", "conventions", "error-handling"],
  hook: "API routes return { data, error } — never throw to the caller.",
};

// ── GENERIC_TOKENS ───────────────────────────────────────────────────────────

describe("GENERIC_TOKENS", () => {
  test("contains the original generic set", () => {
    for (const t of ["push", "dev", "performance", "release", "tests", "git"]) {
      expect(GENERIC_TOKENS.has(t)).toBe(true);
    }
  });

  test("contains the extended generic set", () => {
    for (const t of ["css", "animation", "layout", "email", "settings", "naming", "publishing"]) {
      expect(GENERIC_TOKENS.has(t)).toBe(true);
    }
  });

  test("does not contain note-specific words", () => {
    for (const t of ["drizzle", "sqlite", "testflight", "eas", "lighthouse", "webgl"]) {
      expect(GENERIC_TOKENS.has(t)).toBe(false);
    }
  });
});

// ── tokensFor ────────────────────────────────────────────────────────────────

describe("tokensFor", () => {
  test("splits slug on '-', merges tags, drops stop words and short tokens", () => {
    // "not" is a stop word; "16" and "3" are < 3 chars.
    expect(tokensFor(NEXT_DEV)).toEqual([
      "next",
      "dev",
      "writes",
      "agents",
      "nextjs",
      "dev-server",
    ]);
  });

  test("deduplicates a word that appears in both the slug and tags", () => {
    const tokens = tokensFor(DRIZZLE);
    expect(tokens.filter((t) => t === "drizzle")).toHaveLength(1);
    expect(tokens.filter((t) => t === "sqlite")).toHaveLength(1);
  });
});

// ── scoreNote — worked examples, three-tier weighting ────────────────────────
// Tiers: generic = 1 (wherever it comes from), tag = 3, slug-only = 2. A
// token present in both slug and tags scores as a tag (3).

describe("scoreNote", () => {
  test("'bun drizzle-kit push' scores tag drizzle(3) + generic push(1) = 4 — qualifies", () => {
    expect(scoreNote(DRIZZLE, "bun drizzle-kit push")).toBe(4);
  });

  test("'git push origin main' scores only generic push(1) = 1 — does not qualify", () => {
    expect(scoreNote(DRIZZLE, "git push origin main")).toBe(1);
  });

  test("Write to eas.json alone now qualifies from the path alone: tag eas(3) = 3", () => {
    expect(scoreNote(TESTFLIGHT, "eas.json")).toBe(3);
  });

  test("'bunx next dev' scores slug next(2) + generic dev(1) = 3 — qualifies", () => {
    expect(scoreNote(NEXT_DEV, "bunx next dev")).toBe(3);
  });

  test("'bun run dev' scores only generic dev(1) = 1 — 'next' absent, does not qualify", () => {
    expect(scoreNote(NEXT_DEV, "bun run dev")).toBe(1);
  });

  test("'lighthouse http://localhost:3000' scores tag lighthouse(3) = 3 — qualifies", () => {
    expect(scoreNote(LIGHTHOUSE, "lighthouse http://localhost:3000")).toBe(3);
  });

  // "error" is (and remains) a GENERIC_TOKENS entry, so this slug-only match
  // scores 1 (generic weight), not the 2 a non-generic slug-only token would
  // get — either way it's well under the qualify threshold. The note's own
  // tag is "error-handling" (a distinct token from "error"), so tag weight
  // never applies here.
  test("a command containing only 'error' vs a note where it's a slug word only — does not qualify", () => {
    expect(scoreNote(API_ERROR, "some command failed with error")).toBeLessThan(3);
  });
});

// ── rankNotes ────────────────────────────────────────────────────────────────

describe("rankNotes", () => {
  const ALL = [DRIZZLE, TESTFLIGHT, NEXT_DEV, LIGHTHOUSE];

  test("qualifying notes ranked highest score first, capped at 3", () => {
    const ranked = rankNotes(ALL, "bun drizzle-kit push, then bunx next dev, then git push");
    expect(ranked.map((n) => n.name)).toContain(DRIZZLE.name);
    expect(ranked.map((n) => n.name)).toContain(NEXT_DEV.name);
    expect(ranked.length).toBeLessThanOrEqual(3);
  });

  test("no qualifying note → []", () => {
    expect(rankNotes(ALL, "totally unrelated text about nothing")).toEqual([]);
  });

  test("shown set excludes already-surfaced notes even if they'd otherwise qualify", () => {
    const ranked = rankNotes(ALL, "bun drizzle-kit push", new Set([DRIZZLE.name]));
    expect(ranked.map((n) => n.name)).not.toContain(DRIZZLE.name);
  });
});

// ── End-to-end: spawn the real hook, HOME sandboxed ─────────────────────────
// Same isolation pattern as tests/freeze.test.ts — HOME points at a scratch
// dir so this never touches the real ~/.claude/tmp/knowledge-index.json.

const HINT_HOOK = resolve(import.meta.dir, "..", "src", "hooks", "knowledge-hint.ts");

function baseEnv(home: string): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  env.HOME = home;
  env.USERPROFILE = home;
  return env;
}

async function seedIndex(home: string, notes: KnowledgeNote[]): Promise<void> {
  const dir = join(home, ".claude", "tmp");
  await mkdir(dir, { recursive: true });
  const index: KnowledgeIndex = { notes, checkedAt: new Date().toISOString() };
  await writeFile(join(dir, "knowledge-index.json"), JSON.stringify(index));
}

async function runHintHook(
  home: string,
  payload: { session_id: string; tool_name: string; tool_input: unknown },
): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", HINT_HOOK], {
    env: baseEnv(home),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

describe("knowledge-hint hook (e2e)", () => {
  test("Bash command matching a note emits an additionalContext hint", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-knowledge-hint-"));
    try {
      await seedIndex(home, [DRIZZLE]);
      const { stdout, exit } = await runHintHook(home, {
        session_id: "session-A",
        tool_name: "Bash",
        tool_input: { command: "bun drizzle-kit push" },
      });
      expect(exit).toBe(0);
      expect(stdout).toContain("team-knowledge");
      expect(stdout).toContain(DRIZZLE.name);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("same session, same command a second time → nothing emitted (dedup)", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-knowledge-hint-"));
    try {
      await seedIndex(home, [DRIZZLE]);
      const payload = {
        session_id: "session-A",
        tool_name: "Bash",
        tool_input: { command: "bun drizzle-kit push" },
      };
      const first = await runHintHook(home, payload);
      expect(first.stdout).toContain(DRIZZLE.name);

      const second = await runHintHook(home, payload);
      expect(second.stdout).not.toContain(DRIZZLE.name);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("a different session id sees the hint again", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-knowledge-hint-"));
    try {
      await seedIndex(home, [DRIZZLE]);
      const commandPayload = (sessionId: string) => ({
        session_id: sessionId,
        tool_name: "Bash",
        tool_input: { command: "bun drizzle-kit push" },
      });
      await runHintHook(home, commandPayload("session-A"));
      const other = await runHintHook(home, commandPayload("session-B"));
      expect(other.stdout).toContain(DRIZZLE.name);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("no cache present → silent, exit 0", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-knowledge-hint-"));
    try {
      const { stdout, exit } = await runHintHook(home, {
        session_id: "session-A",
        tool_name: "Bash",
        tool_input: { command: "bun drizzle-kit push" },
      });
      expect(exit).toBe(0);
      expect(stdout).toBe("");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
