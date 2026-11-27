// Tests for the knowledge-hint ranking logic (src/lib/knowledge-hint.ts) and
// one end-to-end spawn test of the hook (src/hooks/knowledge-hint.ts), HOME
// sandboxed per tests/freeze.test.ts's pattern.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  followsNullaFrom,
  GENERIC_TOKENS,
  rankNotes,
  repoNamesFrom,
  scoreNote,
  tokensFor,
} from "../src/lib/knowledge-hint.ts";
import type { KnowledgeIndex, KnowledgeNote } from "../src/lib/knowledge-index.ts";
import { GIT_ISOLATION_ENV } from "./support/git.ts";

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

const PROGRAMA_LOG: KnowledgeNote = {
  name: "programa-release-diagnostics-log",
  kind: "convention",
  tags: ["programa", "debugging", "diagnostics"],
  scope: ["programa"],
  hook: "Programa Release builds log to diagnostics.log.",
};

const LENIS_DECISION: KnowledgeNote = {
  name: "lenis-over-native-smooth-scroll",
  kind: "decision",
  tags: ["frontend", "scroll", "lenis", "scroll-behavior"],
  stack: ["lenis"],
  hook: "Use Lenis instead of CSS scroll-behavior: smooth.",
};

const LAYOUT_READS: KnowledgeNote = {
  name: "no-layout-reads-in-frame-loops",
  kind: "gotcha",
  tags: ["performance", "scroll", "layout", "getboundingclientrect", "requestanimationframe"],
  hook: "No getBoundingClientRect in frame loops; measure once with ResizeObserver.",
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

describe("rankNotes — scope", () => {
  const command = "tail ~/Library/Logs/Programa/diagnostics.log";

  test("a scoped note surfaces when the current repo is in its scope", () => {
    const ranked = rankNotes([PROGRAMA_LOG], command, new Set(), () => new Set(["programa"]));
    expect(ranked.map((n) => n.name)).toEqual([PROGRAMA_LOG.name]);
  });

  test("a scoped note is hidden in another repo", () => {
    expect(rankNotes([PROGRAMA_LOG], command, new Set(), () => new Set(["satus"]))).toEqual([]);
  });

  test("a scoped note is hidden when the repo is unknown", () => {
    expect(rankNotes([PROGRAMA_LOG], command)).toEqual([]);
  });

  test("the repo is not resolved when no scoped note qualifies", () => {
    let calls = 0;
    const repos = () => {
      calls++;
      return new Set<string>();
    };
    expect(rankNotes([DRIZZLE, PROGRAMA_LOG], "bun drizzle-kit push", new Set(), repos)).toEqual([
      DRIZZLE,
    ]);
    expect(calls).toBe(0);
  });
});

describe("rankNotes — stack", () => {
  const css = "main.css html { scroll-behavior: smooth; }";

  test("a stack note surfaces outside Nulla", () => {
    expect(rankNotes([LENIS_DECISION], css).map((n) => n.name)).toEqual([LENIS_DECISION.name]);
  });

  test("a stack note is hidden in a Nulla project", () => {
    expect(rankNotes([LENIS_DECISION], css, new Set(), undefined, () => true)).toEqual([]);
  });

  test("a note without stack still surfaces in a Nulla project", () => {
    const loop = "requestAnimationFrame(() => el.getBoundingClientRect())";
    const ranked = rankNotes(
      [LAYOUT_READS, LENIS_DECISION],
      loop,
      new Set(),
      undefined,
      () => true,
    );
    expect(ranked.map((n) => n.name)).toEqual([LAYOUT_READS.name]);
  });

  test("Nulla is not checked when no stack note qualifies", () => {
    let calls = 0;
    const nulla = () => {
      calls++;
      return true;
    };
    rankNotes([DRIZZLE, LENIS_DECISION], "bun drizzle-kit push", new Set(), undefined, nulla);
    expect(calls).toBe(0);
  });
});

describe("followsNullaFrom", () => {
  test("the kickoff line counts", () => {
    expect(
      followsNullaFrom(
        "This project follows Nulla: https://github.com/darkroomengineering/nulla\nRead its README.",
      ),
    ).toBe(true);
  });

  test("the other declarations in use count", () => {
    expect(
      followsNullaFrom(
        "# GrowthLoop on Nulla\n\nThis project follows the current [Nulla rules](https://github.com/darkroomengineering/nulla/blob/main/RULES.md).",
      ),
    ).toBe(true);
    expect(
      followsNullaFrom("This repository builds the production website with Nulla. Follow the"),
    ).toBe(true);
  });

  test("a passing mention or a link does not count", () => {
    expect(followsNullaFrom("No project in this workspace follows Nulla yet.")).toBe(false);
    expect(
      followsNullaFrom("See the migration plan: https://github.com/darkroomengineering/nulla"),
    ).toBe(false);
  });

  test("an AGENTS.md that does not mention Nulla does not", () => {
    expect(followsNullaFrom("# Satus\nUse Lenis for scroll.")).toBe(false);
    expect(followsNullaFrom("")).toBe(false);
  });
});

describe("repoNamesFrom", () => {
  test("SSH remote plus a worktree folder yields both names", () => {
    expect(
      repoNamesFrom("git@github.com:darkroomengineering/programa.git", "/src/programa-wt-1"),
    ).toEqual(new Set(["programa", "programa-wt-1"]));
  });

  test("HTTPS remote with a trailing slash", () => {
    expect(repoNamesFrom("https://github.com/darkroomengineering/cc-settings/", "")).toEqual(
      new Set(["cc-settings"]),
    );
  });

  test("no origin falls back to the folder; nothing yields an empty set", () => {
    expect(repoNamesFrom("", "/src/plain")).toEqual(new Set(["plain"]));
    expect(repoNamesFrom("", "")).toEqual(new Set());
  });
});

// ── End-to-end: spawn the real hook, HOME sandboxed ─────────────────────────
// Same isolation pattern as tests/freeze.test.ts — HOME points at a scratch
// dir so this never touches the real ~/.claude/tmp/knowledge-index.json.

const HINT_HOOK = resolve(import.meta.dir, "..", "src", "hooks", "knowledge-hint.ts");

function baseEnv(home: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, ...GIT_ISOLATION_ENV };
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
  payload: { session_id: string; tool_name: string; tool_input: unknown; cwd?: string },
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

  test("a scoped note surfaces only when cwd is a checkout of its repo", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-knowledge-hint-"));
    try {
      await seedIndex(home, [PROGRAMA_LOG]);
      const repo = join(home, "programa");
      await mkdir(repo);
      Bun.spawnSync(["git", "init", "-q", repo], {
        env: { ...process.env, ...GIT_ISOLATION_ENV },
      });
      const payload = (sessionId: string, cwd: string) => ({
        session_id: sessionId,
        tool_name: "Bash",
        tool_input: { command: "tail ~/Library/Logs/Programa/diagnostics.log" },
        cwd,
      });
      const inRepo = await runHintHook(home, payload("session-A", repo));
      expect(inRepo.stdout).toContain(PROGRAMA_LOG.name);

      const elsewhere = await runHintHook(home, payload("session-B", home));
      expect(elsewhere.exit).toBe(0);
      expect(elsewhere.stdout).toBe("");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("in a Nulla checkout, stack notes stay hidden and platform notes surface", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-knowledge-hint-"));
    try {
      await seedIndex(home, [LENIS_DECISION, LAYOUT_READS]);
      const nulla = join(home, "site-nulla");
      const satus = join(home, "site-satus");
      for (const repo of [nulla, satus]) {
        await mkdir(repo);
        Bun.spawnSync(["git", "init", "-q", repo], {
          env: { ...process.env, ...GIT_ISOLATION_ENV },
        });
      }
      await writeFile(
        join(nulla, "AGENTS.md"),
        "This project follows Nulla: https://github.com/darkroomengineering/nulla\n",
      );
      const edit = (sessionId: string, cwd: string, content: string) => ({
        session_id: sessionId,
        tool_name: "Write",
        tool_input: { file_path: join(cwd, "src/scroll.js"), content },
        cwd,
      });
      const smooth = "html { scroll-behavior: smooth; }";
      const loop = "requestAnimationFrame(() => el.getBoundingClientRect())";

      const nullaSmooth = await runHintHook(home, edit("session-A", nulla, smooth));
      expect(nullaSmooth.stdout).not.toContain(LENIS_DECISION.name);
      const nullaLoop = await runHintHook(home, edit("session-A", nulla, loop));
      expect(nullaLoop.stdout).toContain(LAYOUT_READS.name);

      const satusSmooth = await runHintHook(home, edit("session-B", satus, smooth));
      expect(satusSmooth.stdout).toContain(LENIS_DECISION.name);
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
