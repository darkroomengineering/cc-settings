// Unit tests for the small shared libs: platform, packages, json-io.
// (The MCP merge integration tests live in tests/mcp.test.ts.)

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pointLatest, pruneStaleFiles } from "../src/lib/artifact-store.ts";
import { installHintForPM, RECOMMENDED_TOOLS } from "../src/lib/cli-preflight.ts";
import { getClaudeMdMonitor } from "../src/lib/hook-config.ts";
import { isUnsafeTarEntry, restoreUnitsFromArchive } from "../src/lib/install-cmds.ts";
import { preflightInstallSource } from "../src/lib/install-fs.ts";
import { isProcessAlive } from "../src/lib/install-lock.ts";
import { atomicWriteJson, JsonParseError, readJsonOrNull } from "../src/lib/json-io.ts";
import { getInstallHint, getInstallHintForPM } from "../src/lib/packages.ts";
import { getTimestamp, hasCommand, os } from "../src/lib/platform.ts";

describe("platform", () => {
  test("os is one of the known values", () => {
    expect(["macos", "linux", "wsl", "windows", "unknown"]).toContain(os);
  });
  test("getTimestamp is 14 digits", () => {
    expect(getTimestamp()).toMatch(/^\d{14}$/);
  });
  test("hasCommand('bun') is true in this test env", () => {
    expect(hasCommand("bun")).toBe(true);
  });
  test("hasCommand('definitely-not-a-cmd-xyz') is false", () => {
    expect(hasCommand("definitely-not-a-cmd-xyz")).toBe(false);
  });
});

describe("packages", () => {
  test("getInstallHint returns a platform-appropriate hint", () => {
    const hint = getInstallHint("jq");
    expect(hint).toContain("jq");
  });

  test("getInstallHintForPM maps each detected system PM to its own command, not a hardcoded apt", () => {
    expect(getInstallHintForPM("apt", "jq")).toBe("sudo apt install jq");
    expect(getInstallHintForPM("dnf", "jq")).toBe("sudo dnf install jq");
    expect(getInstallHintForPM("yum", "jq")).toBe("sudo yum install jq");
    expect(getInstallHintForPM("pacman", "jq")).toBe("sudo pacman -S jq");
    expect(getInstallHintForPM("zypper", "jq")).toBe("sudo zypper install jq");
    expect(getInstallHintForPM("apk", "jq")).toBe("sudo apk add jq");
    expect(getInstallHintForPM("brew", "jq")).toBe("brew install jq");
  });

  test("getInstallHintForPM falls back to an OS-based hint when no system PM was detected", () => {
    expect(getInstallHintForPM(null, "jq")).toContain("jq");
  });
});

describe("cli-preflight", () => {
  const fd = RECOMMENDED_TOOLS.find((t) => t.name === "fd");
  if (!fd) throw new Error("expected 'fd' in RECOMMENDED_TOOLS for this test");

  test("installHintForPM picks the per-manager package name override (fd vs fd-find)", () => {
    expect(installHintForPM(fd, "apt", "linux")).toBe("apt install fd-find");
    expect(installHintForPM(fd, "dnf", "linux")).toBe("dnf install fd-find");
    expect(installHintForPM(fd, "pacman", "linux")).toBe("pacman -S fd");
    expect(installHintForPM(fd, "apk", "linux")).toBe("apk add fd");
  });

  test("installHintForPM never returns the apt hint on a non-apt Linux system PM", () => {
    for (const tool of RECOMMENDED_TOOLS) {
      const hint = installHintForPM(tool, "dnf", "linux");
      expect(hint).not.toBe(tool.install.apt);
    }
  });

  test("installHintForPM prefers brew on macOS regardless of a detected system PM", () => {
    expect(installHintForPM(fd, "dnf", "macos")).toBe(fd.install.brew ?? "");
  });

  test("installHintForPM prefers winget on windows regardless of a detected system PM", () => {
    expect(installHintForPM(fd, "dnf", "windows")).toBe(fd.install.winget ?? "");
  });

  test("installHintForPM falls back to apt when the detected PM has no explicit entry", () => {
    // `port` (macOS MacPorts) has no Linux mapping in the CliTool.install shape;
    // simulate an unmapped PM value reaching the Linux branch.
    expect(installHintForPM(fd, "port", "linux")).toBe(fd.install.apt ?? "");
  });
});

describe("json-io — atomic IO", () => {
  test("atomicWriteJson writes then renames, no tmp left on success", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-aw-"));
    try {
      const target = join(sandbox, "config.json");
      await atomicWriteJson(target, { a: 1, b: "two" });
      const roundtrip = JSON.parse(await readFile(target, "utf8"));
      expect(roundtrip).toEqual({ a: 1, b: "two" });
      // No leftover staging files.
      const { readdirSync } = await import("node:fs");
      const entries = readdirSync(sandbox);
      expect(entries).toEqual(["config.json"]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("readJsonOrNull returns null for missing file", async () => {
    const v = await readJsonOrNull(join(tmpdir(), "cc-missing-file-xyz.json"));
    expect(v).toBeNull();
  });

  test("readJsonOrNull throws JsonParseError on bad JSON", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-bad-"));
    try {
      const target = join(sandbox, "bad.json");
      await writeFile(target, "{this is not valid json");
      await expect(readJsonOrNull(target)).rejects.toBeInstanceOf(JsonParseError);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("readJsonOrNull rethrows non-parse I/O errors as-is (EISDIR is not 'invalid JSON')", async () => {
    // Reading a directory fails with EISDIR — that's an I/O problem, not a
    // corrupt file. It must NOT be wrapped as JsonParseError, which would
    // misdiagnose ("fix it or restore a backup") a permissions/path mistake.
    const sandbox = await mkdtemp(join(tmpdir(), "cc-mcp-eisdir-"));
    try {
      let caught: unknown;
      try {
        await readJsonOrNull(sandbox); // a directory, not a file
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught).not.toBeInstanceOf(JsonParseError);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

describe("hook-config — falsy-zero regression", () => {
  const ENV_KEYS = ["CC_CLAUDE_MD_WARN_LINES", "CC_CLAUDE_MD_CRITICAL_LINES"] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("CC_CLAUDE_MD_WARN_LINES='0' is honored as 0, not the 400 default", async () => {
    // A `parseInt(...) || fallback` bug would read explicit "0" as falsy and
    // silently revive the 400 default.
    saved.CC_CLAUDE_MD_WARN_LINES = process.env.CC_CLAUDE_MD_WARN_LINES;
    process.env.CC_CLAUDE_MD_WARN_LINES = "0";
    const { warnLines } = await getClaudeMdMonitor();
    expect(warnLines).toBe(0);
  });

  test("CC_CLAUDE_MD_CRITICAL_LINES unset still falls back to the 600 default", async () => {
    saved.CC_CLAUDE_MD_CRITICAL_LINES = process.env.CC_CLAUDE_MD_CRITICAL_LINES;
    delete process.env.CC_CLAUDE_MD_CRITICAL_LINES;
    const { criticalLines } = await getClaudeMdMonitor();
    expect(criticalLines).toBe(600);
  });

  test("an unparseable value falls back to the default (NaN, not 0)", async () => {
    saved.CC_CLAUDE_MD_WARN_LINES = process.env.CC_CLAUDE_MD_WARN_LINES;
    process.env.CC_CLAUDE_MD_WARN_LINES = "not-a-number";
    const { warnLines } = await getClaudeMdMonitor();
    expect(warnLines).toBe(400);
  });
});

describe("install-cmds — isUnsafeTarEntry (path-traversal guard)", () => {
  test("absolute path entries are unsafe", () => {
    expect(isUnsafeTarEntry("/etc/passwd")).toBe(true);
  });

  test("'..' path segments are unsafe", () => {
    expect(isUnsafeTarEntry("../../etc/passwd")).toBe(true);
    expect(isUnsafeTarEntry(".claude/../../etc/passwd")).toBe(true);
  });

  test("ordinary relative archive entries are safe", () => {
    expect(isUnsafeTarEntry(".claude/settings.json")).toBe(false);
    expect(isUnsafeTarEntry(".claude.json")).toBe(false);
    expect(isUnsafeTarEntry("settings.json")).toBe(false);
  });

  test("a filename that merely contains '..' as a substring (not a segment) is safe", () => {
    expect(isUnsafeTarEntry(".claude/weird..name.json")).toBe(false);
  });
});

describe("install-cmds — restoreUnitsFromArchive (exact-restore prune set)", () => {
  test("home-relative archive → per-managed-path units under .claude + .claude.json", () => {
    const entries = [
      ".claude/settings.json",
      ".claude/skills/foo/SKILL.md",
      ".claude/skills/bar/SKILL.md",
      ".claude/agents/x.md",
      ".claude.json",
    ];
    expect(restoreUnitsFromArchive(entries, true).sort()).toEqual([
      ".claude.json",
      ".claude/agents",
      ".claude/settings.json",
      ".claude/skills",
    ]);
  });

  test("claude-dir-relative archive → first-segment units", () => {
    const entries = ["settings.json", "agents/x.md", "skills/foo/SKILL.md"];
    expect(restoreUnitsFromArchive(entries, false).sort()).toEqual([
      "agents",
      "settings.json",
      "skills",
    ]);
  });

  test("a bare '.' or './'-prefixed entry never yields the extract-root unit", () => {
    // Regression: a "." unit would rm the whole extract root (~/.claude) — the
    // single-dot case isUnsafeTarEntry does not catch. Must be dropped.
    expect(restoreUnitsFromArchive(["."], false)).toEqual([]);
    expect(restoreUnitsFromArchive(["./"], false)).toEqual([]);
    expect(restoreUnitsFromArchive(["./agents/x.md"], false)).toEqual(["agents"]);
    expect(restoreUnitsFromArchive(["./.claude/skills/a", "./.claude.json"], true).sort()).toEqual([
      ".claude.json",
      ".claude/skills",
    ]);
  });

  test("empty/blank entries are ignored", () => {
    expect(restoreUnitsFromArchive(["", "   ", "agents/x"], false)).toEqual(["agents"]);
  });

  test("prunes ONLY managed paths — a rogue entry can't delete backups/src/etc.", () => {
    // A hand-crafted or foreign archive containing non-managed top-level paths
    // must never widen the prune set — otherwise a `.claude/backups/x` entry
    // would rm the backups dir (including the archive being restored).
    const rogue = [
      ".claude/settings.json", // managed → kept
      ".claude/agents/a.md", // managed → kept
      ".claude/backups/old.tar.gz", // NOT managed → dropped
      ".claude/src/setup.ts", // NOT managed → dropped
      ".claude/tmp/x", // NOT managed → dropped
      ".claude/totally-unknown/y", // NOT managed → dropped
    ];
    expect(restoreUnitsFromArchive(rogue, true).sort()).toEqual([
      ".claude/agents",
      ".claude/settings.json",
    ]);
  });
});

describe("install-lock — isProcessAlive", () => {
  test("our own pid is alive", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });
  test("a non-positive pid is never alive", () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
  });
  test("a very high, almost-certainly-unused pid is not alive", () => {
    expect(isProcessAlive(2_000_000_000)).toBe(false);
  });
});

describe("install-fs — preflightInstallSource skill-children", () => {
  async function srcDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "cc-preflight-"));
    // Minimal valid light source: config/ + src/ (with setup.ts) + skills/.
    await mkdir(join(dir, "config"), { recursive: true });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "setup.ts"), "// stub");
    await mkdir(join(dir, "skills"), { recursive: true });
    return dir;
  }

  test("throws when a required skill is missing under a present skills/", async () => {
    const dir = await srcDir();
    try {
      // skills/ exists but share-learning (the sole LIGHT_SKILLS entry) does not.
      expect(() => preflightInstallSource(dir, "light")).toThrow(/share-learning/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("passes when the required skill's SKILL.md is present", async () => {
    const dir = await srcDir();
    try {
      await mkdir(join(dir, "skills", "share-learning"), { recursive: true });
      await writeFile(join(dir, "skills", "share-learning", "SKILL.md"), "x");
      expect(() => preflightInstallSource(dir, "light")).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("artifact-store — pointLatest atomicity", () => {
  test("creates a symlink pointing at the target's basename", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-artifact-pl-"));
    try {
      const target = join(sandbox, "chk-1.json");
      await writeFile(target, "{}");
      await pointLatest(sandbox, target, "latest");
      expect(await readlink(join(sandbox, "latest"))).toBe("chk-1.json");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("repointing an existing link leaves no leftover .tmp staging file", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-artifact-pl-"));
    try {
      const t1 = join(sandbox, "chk-1.json");
      const t2 = join(sandbox, "chk-2.json");
      await writeFile(t1, "{}");
      await writeFile(t2, "{}");
      await pointLatest(sandbox, t1, "latest");
      await pointLatest(sandbox, t2, "latest"); // repoint — exercises the rename-over-existing-link path
      expect(await readlink(join(sandbox, "latest"))).toBe("chk-2.json");
      const entries = await readdir(sandbox);
      expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
      expect(existsSync(join(sandbox, "latest"))).toBe(true);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

describe("artifact-store — pruneStaleFiles", () => {
  test("returns matching files older than maxAgeDays, skips fresh and non-matching files", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "cc-artifact-psf-"));
    try {
      const old = join(sandbox, "tool-failure-counts-abc123");
      const fresh = join(sandbox, "tool-failure-counts-def456");
      const nonMatching = join(sandbox, "rate-limits.json");
      await writeFile(old, "{}");
      await writeFile(fresh, "{}");
      await writeFile(nonMatching, "{}");

      const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await utimes(old, oldTime, oldTime); // backdate mtime past the 7-day cutoff

      const stale = await pruneStaleFiles(sandbox, /^tool-failure-counts-/, 7);
      expect(stale).toEqual([old]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("missing dir returns []", async () => {
    const stale = await pruneStaleFiles(join(tmpdir(), "cc-artifact-psf-missing"), /.*/, 7);
    expect(stale).toEqual([]);
  });
});
