import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeDrift, readPackagedVersion, readSentinelInfo } from "../src/lib/version-delta.ts";

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
      expect(await readSentinelInfo(dir)).toEqual({ version: null, repoPath: null });
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
      expect(await readSentinelInfo(dir)).toEqual({ version: "11.12.0", repoPath: "/x/y" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("legacy sentinel without repo_path ⇒ repoPath null", async () => {
    const dir = await tmp();
    try {
      await writeFile(join(dir, ".cc-settings-version"), JSON.stringify({ version: "11.0.0" }));
      expect(await readSentinelInfo(dir)).toEqual({ version: "11.0.0", repoPath: null });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("malformed JSON ⇒ nulls", async () => {
    const dir = await tmp();
    try {
      await writeFile(join(dir, ".cc-settings-version"), "{not json");
      expect(await readSentinelInfo(dir)).toEqual({ version: null, repoPath: null });
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
