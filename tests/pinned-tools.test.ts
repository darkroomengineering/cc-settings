import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CryptoHasher } from "bun";
import type { PinnedToolDescriptor } from "../src/lib/pinned-tools.ts";
import { ensurePinnedTool, pinnedToolPath, TLDR_CODE_TOOL } from "../src/lib/pinned-tools.ts";
import { platformKey } from "../src/lib/platform.ts";

const CONTENT = "fake-tldr-binary-v1";
const TRIPLE = "fake-triple";

function sha256(bytes: Uint8Array): string {
  const h = new CryptoHasher("sha256");
  h.update(bytes);
  return h.digest("hex");
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ccpinnedtools-"));
}

// Builds a real tar.xz archive shaped like a tldr-code release asset
// (tldr-cli-<TRIPLE>/tldr inside), using the local `tar` binary — no network
// involved. Mirrors what the real release asset looks like once downloaded.
async function buildFixtureArchive(workDir: string): Promise<Uint8Array> {
  const stageDir = join(workDir, `tldr-cli-${TRIPLE}`);
  await mkdir(stageDir, { recursive: true });
  await writeFile(join(stageDir, "tldr"), CONTENT);
  const archivePath = join(workDir, "fixture.tar.xz");
  const proc = Bun.spawn(["tar", "-cJf", archivePath, "-C", workDir, `tldr-cli-${TRIPLE}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`fixture tar creation failed (exit ${code})`);
  return new Uint8Array(await readFile(archivePath));
}

function makeTool(
  checksums: Record<string, { triple: string; sha256: string }>,
  archiveBinPath = `tldr-cli-<TRIPLE>/tldr`,
): PinnedToolDescriptor {
  return {
    id: "test-tldr-code",
    version: "0.0.0-test",
    binName: "tldr",
    // Placeholder never hit — fetch is stubbed in every test below.
    urlTemplate: "https://example.invalid/test-cli-<TRIPLE>.tar.xz",
    // Matches buildFixtureArchive's layout. Overridable so the wrong-layout
    // case below can exercise a descriptor that disagrees with its archive.
    archiveBinPath,
    platforms: checksums,
  };
}

const originalFetch = globalThis.fetch;

function stubFetch(
  impl: () => Promise<{ ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }>,
): void {
  globalThis.fetch = impl as unknown as typeof fetch;
}

function okFetch(bytes: Uint8Array) {
  return async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("TLDR_CODE_TOOL descriptor", () => {
  // F2: the archive's inner layout used to be hardcoded inside
  // ensurePinnedTool, so the descriptor could not describe its own asset.
  test("declares archiveBinPath with a <TRIPLE> token and ends in binName", () => {
    expect(TLDR_CODE_TOOL.archiveBinPath).toContain("<TRIPLE>");
    expect(TLDR_CODE_TOOL.archiveBinPath.endsWith(`/${TLDR_CODE_TOOL.binName}`)).toBe(true);
  });

  test("has a 64-char sha256 for all four platform keys", () => {
    const expectedKeys = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
    expect(Object.keys(TLDR_CODE_TOOL.platforms).sort()).toEqual(expectedKeys.sort());
    for (const key of expectedKeys) {
      const plat = TLDR_CODE_TOOL.platforms[key];
      expect(plat).toBeDefined();
      expect(plat?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(plat?.triple.length).toBeGreaterThan(0);
    }
  });
});

describe("pinnedToolPath", () => {
  test("returns the expected ~/.claude/code-intel/<id>/<version>/<binName> shape", () => {
    const path = pinnedToolPath("tldr-code", "0.4.0", "tldr", "/home/user/.claude");
    expect(path).toBe(join("/home/user/.claude", "code-intel", "tldr-code", "0.4.0", "tldr"));
  });
});

describe("ensurePinnedTool", () => {
  test("no pinned checksum for this platform ⇒ null, no throw", async () => {
    const dir = await tmp();
    try {
      const tool = makeTool({}); // no checksum for any platform, including the current one
      expect(await ensurePinnedTool(tool, dir)).toBeNull();
      expect(existsSync(pinnedToolPath(tool.id, tool.version, tool.binName, dir))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("HTTP error ⇒ null (fail-soft)", async () => {
    const dir = await tmp();
    try {
      stubFetch(async () => ({
        ok: false,
        status: 500,
        arrayBuffer: async () => new ArrayBuffer(0),
      }));
      const tool = makeTool({ [platformKey()]: { triple: TRIPLE, sha256: "0".repeat(64) } });
      expect(await ensurePinnedTool(tool, dir)).toBeNull();
      expect(existsSync(pinnedToolPath(tool.id, tool.version, tool.binName, dir))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("checksum mismatch throws and leaves no file behind", async () => {
    const dir = await tmp();
    const workDir = await tmp();
    try {
      const archiveBytes = await buildFixtureArchive(workDir);
      stubFetch(okFetch(archiveBytes));
      // Pin a wrong (but well-formed) checksum so the download fails verification.
      // The mismatch check runs BEFORE extraction, so this never reaches `tar`.
      const tool = makeTool({ [platformKey()]: { triple: TRIPLE, sha256: "1".repeat(64) } });
      await expect(ensurePinnedTool(tool, dir)).rejects.toThrow(/checksum mismatch/);
      expect(existsSync(pinnedToolPath(tool.id, tool.version, tool.binName, dir))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("matching checksum downloads, extracts, and installs the binary", async () => {
    const dir = await tmp();
    const workDir = await tmp();
    try {
      const archiveBytes = await buildFixtureArchive(workDir);
      stubFetch(okFetch(archiveBytes));
      const tool = makeTool({
        [platformKey()]: { triple: TRIPLE, sha256: sha256(archiveBytes) },
      });
      const dest = await ensurePinnedTool(tool, dir);
      expect(dest).toBe(pinnedToolPath(tool.id, tool.version, tool.binName, dir));
      expect(existsSync(dest as string)).toBe(true);
      expect(await readFile(dest as string, "utf8")).toBe(CONTENT);
      // Second call reuses the already-installed binary without re-fetching.
      stubFetch(async () => {
        throw new Error("should not be called — binary already installed");
      });
      expect(await ensurePinnedTool(tool, dir)).toBe(dest);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(workDir, { recursive: true, force: true });
    }
  });

  // F2 regression: the archive's inner path is descriptor-driven, not hardcoded
  // to tldr-code's `tldr-cli-<TRIPLE>/` layout. A tool whose archive uses a
  // different layout must be installable by setting archiveBinPath — and when
  // the descriptor disagrees with the archive, the warning must name the field
  // rather than implying the upstream asset is broken.
  test("archiveBinPath drives extraction — a non-tldr layout installs", async () => {
    const dir = await tmp();
    const workDir = await tmp();
    try {
      // Archive laid out as `bin/tldr`, nothing like the tldr-code convention.
      await mkdir(join(workDir, "bin"), { recursive: true });
      await writeFile(join(workDir, "bin", "tldr"), CONTENT);
      const archivePath = join(workDir, "other.tar.xz");
      const proc = Bun.spawn(["tar", "-cJf", archivePath, "-C", workDir, "bin"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(await proc.exited).toBe(0);
      const archiveBytes = new Uint8Array(await readFile(archivePath));

      stubFetch(okFetch(archiveBytes));
      const tool = makeTool(
        { [platformKey()]: { triple: TRIPLE, sha256: sha256(archiveBytes) } },
        "bin/tldr",
      );
      const dest = await ensurePinnedTool(tool, dir);
      expect(dest).toBe(pinnedToolPath(tool.id, tool.version, tool.binName, dir));
      expect(await readFile(dest as string, "utf8")).toBe(CONTENT);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(workDir, { recursive: true, force: true });
    }
  });

  // Defense in depth: descriptors are in-source, so a `..` path is not reachable
  // input today — but the resolved path is renamed into the install location, so
  // containment is asserted rather than assumed.
  test("archiveBinPath escaping the staging root ⇒ null, target left untouched", async () => {
    const dir = await tmp();
    const workDir = await tmp();
    try {
      const archiveBytes = await buildFixtureArchive(workDir);
      stubFetch(okFetch(archiveBytes));

      // staging is <dir>/code-intel/<id>/<version>/extract-XXXX, so four levels
      // up is <dir>. Plant a real file there: the escape target must EXIST, or
      // the containment branch is never reached and the weaker "missing from
      // archive" branch answers instead.
      const escapeTarget = join(dir, "escape-target");
      await writeFile(escapeTarget, "do-not-move-me");

      const tool = makeTool(
        { [platformKey()]: { triple: TRIPLE, sha256: sha256(archiveBytes) } },
        "../../../../escape-target",
      );
      expect(await ensurePinnedTool(tool, dir)).toBeNull();
      expect(existsSync(pinnedToolPath(tool.id, tool.version, tool.binName, dir))).toBe(false);
      // The outside file was neither moved nor consumed.
      expect(await readFile(escapeTarget, "utf8")).toBe("do-not-move-me");
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("archiveBinPath pointing at a directory ⇒ null, nothing installed", async () => {
    const dir = await tmp();
    const workDir = await tmp();
    try {
      const archiveBytes = await buildFixtureArchive(workDir);
      stubFetch(okFetch(archiveBytes));
      // The archive's inner directory exists, but it is not a regular file.
      const tool = makeTool(
        { [platformKey()]: { triple: TRIPLE, sha256: sha256(archiveBytes) } },
        "tldr-cli-<TRIPLE>",
      );
      expect(await ensurePinnedTool(tool, dir)).toBeNull();
      expect(existsSync(pinnedToolPath(tool.id, tool.version, tool.binName, dir))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("archiveBinPath that disagrees with the archive ⇒ null, nothing installed", async () => {
    const dir = await tmp();
    const workDir = await tmp();
    try {
      const archiveBytes = await buildFixtureArchive(workDir);
      stubFetch(okFetch(archiveBytes));
      const tool = makeTool(
        { [platformKey()]: { triple: TRIPLE, sha256: sha256(archiveBytes) } },
        "wrong/place/tldr",
      );
      expect(await ensurePinnedTool(tool, dir)).toBeNull();
      expect(existsSync(pinnedToolPath(tool.id, tool.version, tool.binName, dir))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(workDir, { recursive: true, force: true });
    }
  });

  // Regression: reuse used to trust existsSync alone, so a binary replaced
  // after install was handed straight back and executed. Reuse must verify the
  // recorded digest and re-download anything that no longer matches.
  test("a tampered installed binary is not reused — it is re-downloaded", async () => {
    const dir = await tmp();
    const workDir = await tmp();
    try {
      const archiveBytes = await buildFixtureArchive(workDir);
      const tool = makeTool({
        [platformKey()]: { triple: TRIPLE, sha256: sha256(archiveBytes) },
      });
      stubFetch(okFetch(archiveBytes));
      const dest = (await ensurePinnedTool(tool, dir)) as string;
      expect(existsSync(dest)).toBe(true);

      // Simulate post-install tampering.
      await writeFile(dest, "#!/bin/sh\nexfiltrate --everything\n");
      expect(await readFile(dest, "utf8")).not.toBe(CONTENT);

      // Must NOT short-circuit on existence — re-fetches and restores the pinned bytes.
      let refetched = false;
      const serve = okFetch(archiveBytes);
      stubFetch(async () => {
        refetched = true;
        return serve();
      });
      const again = await ensurePinnedTool(tool, dir);
      expect(refetched).toBe(true);
      expect(again).toBe(dest);
      expect(await readFile(dest, "utf8")).toBe(CONTENT);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
