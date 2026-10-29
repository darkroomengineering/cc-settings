// The Linear map: team-knowledge's linear-map.json cached under ~/.claude/tmp,
// printed as one SessionStart line, never fetched on the hot path.
//   - pure matching and the awareness seam (githubSlugFrom, linearLines, linearMapAwareness)
//   - refresh-knowledge-index.ts against a fake `gh`: fresh cache, stale cache,
//     404, bad JSON, wrong shape — a failed fetch never overwrites a good cache
//   - session-start.ts end to end: mapped, unmapped org repo, repo outside the
//     org, no cache, expired cache

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { githubSlugFrom, linearLines, linearMapAwareness } from "../src/lib/team-knowledge.ts";
import { GIT_ISOLATION_ENV, git, makeRepo } from "./support/git.ts";
import { gitBashPath, prependTestPath } from "./support/portable-process.ts";
import { spawnCapture } from "./support/proc.ts";
import { sandbox } from "./support/tmp.ts";

// Git and bun subprocesses can exceed Bun's five-second default on a loaded Windows runner.
setDefaultTimeout(30_000);

const SESSION_START = resolve(import.meta.dir, "..", "src", "scripts", "session-start.ts");
const REFRESH = resolve(import.meta.dir, "..", "src", "scripts", "refresh-knowledge-index.ts");

const MAP = {
  "darkroomengineering/example-site": { team: "DR", project: "P-DR-1" },
  "darkroomengineering/named": { team: "OSS", project: "P-OSS-1", projectName: "Open Source" },
  "darkroomengineering/no-linear": null,
};

// --- Pure -------------------------------------------------------------------

describe("githubSlugFrom", () => {
  test.each([
    ["https://github.com/darkroomengineering/example-site.git", "darkroomengineering/example-site"],
    ["https://github.com/darkroomengineering/example-site", "darkroomengineering/example-site"],
    ["git@github.com:darkroomengineering/example-site.git", "darkroomengineering/example-site"],
    [
      "ssh://git@github.com/darkroomengineering/example-site.git",
      "darkroomengineering/example-site",
    ],
    ["https://x-access-token:abc@github.com/owner/repo.git/", "owner/repo"],
  ])("%s", (url, slug) => {
    expect(githubSlugFrom(url)).toBe(slug);
  });

  test.each([
    "",
    "https://gitlab.com/darkroomengineering/example-site.git",
    "/local/path/website.git",
  ])("returns null for %p", (url) => {
    expect(githubSlugFrom(url)).toBeNull();
  });
});

describe("linearLines", () => {
  test("mapped repo prints team and project id", () => {
    expect(linearLines("darkroomengineering/example-site", MAP)).toEqual([
      'Linear: team DR, project "P-DR-1"',
    ]);
  });

  test("project name replaces the id when the map has one", () => {
    expect(linearLines("darkroomengineering/named", MAP)).toEqual([
      'Linear: team OSS, project "Open Source"',
    ]);
  });

  test("repo match ignores case", () => {
    expect(linearLines("DarkroomEngineering/Website", MAP)).toHaveLength(1);
  });

  test("unmapped org repo asks for an entry", () => {
    const [line, ...rest] = linearLines("darkroomengineering/new-thing", MAP);
    expect(rest).toEqual([]);
    expect(line).toContain("darkroomengineering/new-thing has no entry in linear-map.json");
    expect(line).toContain("by PR");
  });

  test("repo outside the org prints nothing, mapped or not", () => {
    expect(linearLines("someone/personal-repo", MAP)).toEqual([]);
    expect(linearLines("lenis-fork/lenis", { "lenis-fork/lenis": null })).toEqual([]);
  });

  test("a repo mapped to null prints nothing", () => {
    expect(linearLines("darkroomengineering/no-linear", MAP)).toEqual([]);
  });
});

describe("linearMapAwareness", () => {
  const origin = (url: string) => async () => url;

  test("no cache: silent, and git is never consulted", async () => {
    let asked = false;
    const lines = await linearMapAwareness(
      async () => {
        asked = true;
        return "https://github.com/darkroomengineering/example-site.git";
      },
      async () => null,
    );
    expect(lines).toEqual([]);
    expect(asked).toBe(false);
  });

  test("mapped repo", async () => {
    const lines = await linearMapAwareness(
      origin("git@github.com:darkroomengineering/example-site.git"),
      async () => MAP,
    );
    expect(lines).toEqual(['Linear: team DR, project "P-DR-1"']);
  });

  test("no origin remote: silent", async () => {
    expect(await linearMapAwareness(origin(""), async () => MAP)).toEqual([]);
  });

  test("a throwing reader or git never escapes", async () => {
    expect(
      await linearMapAwareness(origin("x"), async () => {
        throw new Error("boom");
      }),
    ).toEqual([]);
    expect(
      await linearMapAwareness(
        async () => {
          throw new Error("boom");
        },
        async () => MAP,
      ),
    ).toEqual([]);
  });
});

// --- Process-level fixtures -------------------------------------------------

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await sandbox(prefix);
  cleanups.push(dir);
  return dir;
}

function cachePath(home: string): string {
  return join(home, ".claude", "tmp", "linear-map.json");
}

async function writeCache(home: string, checkedAt: Date, map: unknown = MAP): Promise<string> {
  await mkdir(join(home, ".claude", "tmp"), { recursive: true });
  const text = JSON.stringify({ map, checkedAt: checkedAt.toISOString() });
  await writeFile(cachePath(home), text);
  return text;
}

const HOURS = 3_600_000;
const hoursAgo = (h: number) => new Date(Date.now() - h * HOURS);

/** Runs session-start in a repo whose origin is `originUrl`, under a throwaway HOME. */
async function sessionStart(home: string, originUrl: string): Promise<string> {
  const repo = await makeRepo("cc-linear-repo");
  cleanups.push(repo);
  await git(repo, ["remote", "add", "origin", originUrl]);
  const { stdout, exit } = await spawnCapture(["bun", SESSION_START], {
    cwd: repo,
    env: { ...GIT_ISOLATION_ENV, HOME: home, USERPROFILE: home, KNOWLEDGE_REPO_PATH: undefined },
    stdin: JSON.stringify({ session_id: "sess-linear", source: "startup" }),
  });
  expect(exit).toBe(0);
  return stdout;
}

describe("session-start Linear line", () => {
  test("mapped repo prints team and project", async () => {
    const home = await tempDir("cc-linear-home");
    await writeCache(home, hoursAgo(1));
    const out = await sessionStart(home, "https://github.com/darkroomengineering/example-site.git");
    expect(out).toContain('Linear: team DR, project "P-DR-1"');
  });

  test("unmapped org repo asks for an entry", async () => {
    const home = await tempDir("cc-linear-home");
    await writeCache(home, hoursAgo(1));
    const out = await sessionStart(home, "git@github.com:darkroomengineering/brand-new-repo.git");
    expect(out).toContain("darkroomengineering/brand-new-repo has no entry in linear-map.json");
  });

  test("repo outside the org prints nothing", async () => {
    const home = await tempDir("cc-linear-home");
    await writeCache(home, hoursAgo(1));
    const out = await sessionStart(home, "https://github.com/someone/personal-repo.git");
    expect(out).not.toContain("Linear:");
  });

  test("no cache prints nothing", async () => {
    const home = await tempDir("cc-linear-home");
    const out = await sessionStart(home, "https://github.com/darkroomengineering/example-site.git");
    expect(out).not.toContain("Linear:");
  });

  test("a cache older than a week is ignored", async () => {
    const home = await tempDir("cc-linear-home");
    await writeCache(home, hoursAgo(24 * 8));
    const out = await sessionStart(home, "https://github.com/darkroomengineering/example-site.git");
    expect(out).not.toContain("Linear:");
  });
});

// --- Refresh against a fake gh ----------------------------------------------

const FRESH_MAP = { "darkroomengineering/new": { team: "DR", project: "P-DR-99" } };

interface RefreshRun {
  home: string;
  calls: string[];
}

/** Runs the detached refresh script with a fake `gh` that answers the
 *  linear-map.json request with `body` (or exits 1 when `body` is null) and
 *  fails every other request, as an unreachable INDEX.md would. */
async function refresh(home: string, body: string | null): Promise<RefreshRun> {
  const dir = await tempDir("cc-linear-gh");
  const bin = join(dir, "bin");
  await mkdir(bin);
  const log = join(dir, "calls.log");
  const payload = join(dir, "payload.b64");
  await writeFile(log, "");
  await writeFile(payload, body === null ? "" : Buffer.from(body).toString("base64"));
  await writeFile(
    join(bin, "gh"),
    [
      "#!/usr/bin/env bash",
      'echo "$*" >> "$FAKE_GH_LOG"',
      'case "$*" in *contents/linear-map.json*) ;; *) exit 1 ;; esac',
      '[ -s "$FAKE_GH_PAYLOAD" ] || exit 1',
      'cat "$FAKE_GH_PAYLOAD"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const { exit } = await spawnCapture(["bun", REFRESH], {
    env: {
      ...GIT_ISOLATION_ENV,
      HOME: home,
      USERPROFILE: home,
      PATH: prependTestPath(bin),
      FAKE_GH_LOG: gitBashPath(log),
      FAKE_GH_PAYLOAD: gitBashPath(payload),
    },
  });
  expect(exit).toBe(0);
  const calls = (await readFile(log, "utf8")).split("\n").filter((l) => l.includes("linear-map"));
  return { home, calls };
}

describe("refresh-knowledge-index.ts Linear map cache", () => {
  test("no cache: fetches and writes the map", async () => {
    const home = await tempDir("cc-linear-home");
    const { calls } = await refresh(home, JSON.stringify(FRESH_MAP));
    expect(calls).toHaveLength(1);
    const cache = JSON.parse(await readFile(cachePath(home), "utf8"));
    expect(cache.map).toEqual(FRESH_MAP);
    expect(Date.now() - Date.parse(cache.checkedAt)).toBeLessThan(60_000);
  });

  test("fresh cache: no fetch, cache untouched", async () => {
    const home = await tempDir("cc-linear-home");
    const before = await writeCache(home, hoursAgo(1));
    const { calls } = await refresh(home, JSON.stringify(FRESH_MAP));
    expect(calls).toEqual([]);
    expect(await readFile(cachePath(home), "utf8")).toBe(before);
  });

  test("stale cache: refetches and replaces it", async () => {
    const home = await tempDir("cc-linear-home");
    await writeCache(home, hoursAgo(7));
    const { calls } = await refresh(home, JSON.stringify(FRESH_MAP));
    expect(calls).toHaveLength(1);
    expect(JSON.parse(await readFile(cachePath(home), "utf8")).map).toEqual(FRESH_MAP);
  });

  test("404 on a stale cache keeps the old cache byte for byte", async () => {
    const home = await tempDir("cc-linear-home");
    const before = await writeCache(home, hoursAgo(7));
    const { calls } = await refresh(home, null);
    expect(calls).toHaveLength(1);
    expect(await readFile(cachePath(home), "utf8")).toBe(before);
  });

  test("404 with no cache writes nothing", async () => {
    const home = await tempDir("cc-linear-home");
    await refresh(home, null);
    expect(await Bun.file(cachePath(home)).exists()).toBe(false);
  });

  test.each([
    ["not JSON", "this is not json"],
    ["wrong shape", JSON.stringify({ "darkroomengineering/x": { team: "DR" } })],
    ["bad repo key", JSON.stringify({ x: { team: "DR", project: "P-DR-1" } })],
    [
      "newline in a value",
      JSON.stringify({ "o/r": { team: "DR", project: "P-1", projectName: "a\nb" } }),
    ],
    ["empty map", "{}"],
    ["array", "[]"],
  ])("%s on a stale cache keeps the old cache byte for byte", async (_label, body) => {
    const home = await tempDir("cc-linear-home");
    const before = await writeCache(home, hoursAgo(7));
    const { calls } = await refresh(home, body);
    expect(calls).toHaveLength(1);
    expect(await readFile(cachePath(home), "utf8")).toBe(before);
  });
});
