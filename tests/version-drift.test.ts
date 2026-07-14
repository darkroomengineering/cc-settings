import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeDrift,
  readPackagedVersion,
  readSentinelInfo,
  refreshSessionInstallMap,
  SESSION_MAP_CAP,
} from "../src/lib/version-delta.ts";

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ccver-"));
}

describe("computeDrift", () => {
  test("stale when packaged newer", () => {
    expect(computeDrift("11.12.0", "11.13.0").stale).toBe(true);
  });
  test("not stale when equal", () => {
    expect(computeDrift("11.12.0", "11.12.0").stale).toBe(false);
  });
  test("not stale when packaged older (downgrade/rollback)", () => {
    expect(computeDrift("11.13.0", "11.12.0").stale).toBe(false);
  });
  test("not stale when either side unknown", () => {
    expect(computeDrift(null, "11.13.0").stale).toBe(false);
    expect(computeDrift("11.12.0", null).stale).toBe(false);
    expect(computeDrift(null, null).stale).toBe(false);
  });
  test("carries both versions through", () => {
    expect(computeDrift("11.12.0", "11.13.0")).toEqual({
      stale: true,
      installed: "11.12.0",
      packaged: "11.13.0",
    });
  });
});

describe("readSentinelInfo", () => {
  test("missing sentinel ⇒ nulls", async () => {
    const dir = await tmp();
    try {
      expect(await readSentinelInfo(dir)).toEqual({
        version: null,
        repoPath: null,
        engine: null,
        autoUpdate: null,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("reads version + repo_path", async () => {
    const dir = await tmp();
    try {
      await writeFile(
        join(dir, ".cc-settings-version"),
        JSON.stringify({ version: "11.12.0", repo_path: "/x/y", installer: "src/setup.ts" }),
      );
      expect(await readSentinelInfo(dir)).toEqual({
        version: "11.12.0",
        repoPath: "/x/y",
        engine: null,
        autoUpdate: null,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("reads engine when present", async () => {
    const dir = await tmp();
    try {
      await writeFile(
        join(dir, ".cc-settings-version"),
        JSON.stringify({ version: "11.30.3", repo_path: "/x/y", engine: "native-ts" }),
      );
      expect(await readSentinelInfo(dir)).toEqual({
        version: "11.30.3",
        repoPath: "/x/y",
        engine: "native-ts",
        autoUpdate: null,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("legacy sentinel without repo_path ⇒ repoPath null", async () => {
    const dir = await tmp();
    try {
      await writeFile(join(dir, ".cc-settings-version"), JSON.stringify({ version: "11.0.0" }));
      expect(await readSentinelInfo(dir)).toEqual({
        version: "11.0.0",
        repoPath: null,
        engine: null,
        autoUpdate: null,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("malformed JSON ⇒ nulls", async () => {
    const dir = await tmp();
    try {
      await writeFile(join(dir, ".cc-settings-version"), "{not json");
      expect(await readSentinelInfo(dir)).toEqual({
        version: null,
        repoPath: null,
        engine: null,
        autoUpdate: null,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("reads auto_update boolean when present", async () => {
    const dir = await tmp();
    try {
      await writeFile(
        join(dir, ".cc-settings-version"),
        JSON.stringify({ version: "12.3.0", repo_path: "/x/y", auto_update: true }),
      );
      expect(await readSentinelInfo(dir)).toEqual({
        version: "12.3.0",
        repoPath: "/x/y",
        engine: null,
        autoUpdate: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readPackagedVersion", () => {
  test("null repoPath ⇒ null", async () => {
    expect(await readPackagedVersion(null)).toBeNull();
  });
  test("deleted clone ⇒ null", async () => {
    expect(await readPackagedVersion("/no/such/repo/anywhere")).toBeNull();
  });
  test("parses const VERSION from src/setup.ts", async () => {
    const dir = await tmp();
    try {
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(
        join(dir, "src", "setup.ts"),
        'const VERSION = "12.0.3"; // sync with Claude Code\n',
      );
      expect(await readPackagedVersion(dir)).toBe("12.0.3");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("returns null when constant absent", async () => {
    const dir = await tmp();
    try {
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src", "setup.ts"), "export const x = 1;\n");
      expect(await readPackagedVersion(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("end-to-end", () => {
  test("stale when repo VERSION ahead of sentinel", async () => {
    const claudeDir = await tmp();
    const repoDir = await tmp();
    try {
      await mkdir(join(repoDir, "src"), { recursive: true });
      await writeFile(join(repoDir, "src", "setup.ts"), 'const VERSION = "11.13.0";\n');
      await writeFile(
        join(claudeDir, ".cc-settings-version"),
        JSON.stringify({ version: "11.12.0", repo_path: repoDir }),
      );
      const { version, repoPath } = await readSentinelInfo(claudeDir);
      const packaged = await readPackagedVersion(repoPath);
      expect(computeDrift(version, packaged)).toEqual({
        stale: true,
        installed: "11.12.0",
        packaged: "11.13.0",
      });
    } finally {
      await rm(claudeDir, { recursive: true, force: true });
      await rm(repoDir, { recursive: true, force: true });
    }
  });
});

describe("refreshSessionInstallMap", () => {
  test("records a new session at the given version", () => {
    const out = refreshSessionInstallMap({}, "s1", "12.3.1", 1000);
    expect(out).toEqual({ s1: { v: "12.3.1", t: 1000 } });
  });

  test("REFRESHES an existing entry — the resumed-session fix", () => {
    // A resumed session keeps its session_id; the entry recorded days ago at
    // an older version must be overwritten with the current install so the
    // restart-pending banner clears after a restart.
    const stale = { s1: { v: "12.2.6", t: 1 } };
    const out = refreshSessionInstallMap(stale, "s1", "12.3.1", 2000);
    expect(out).toEqual({ s1: { v: "12.3.1", t: 2000 } });
  });

  test("prunes to SESSION_MAP_CAP most recent entries, keeping the refreshed one", () => {
    const map: Record<string, { v: string; t: number }> = {};
    for (let i = 0; i < SESSION_MAP_CAP + 5; i++) map[`s${i}`] = { v: "12.3.0", t: i };
    const out = refreshSessionInstallMap(map, "fresh", "12.3.1", 10_000);
    expect(Object.keys(out).length).toBe(SESSION_MAP_CAP);
    expect(out.fresh).toEqual({ v: "12.3.1", t: 10_000 });
    // Oldest entries were dropped.
    expect(out.s0).toBeUndefined();
  });

  test("does not mutate the input map", () => {
    const input = { s1: { v: "12.2.6", t: 1 } };
    refreshSessionInstallMap(input, "s1", "12.3.1", 2000);
    expect(input.s1.v).toBe("12.2.6");
  });
});
