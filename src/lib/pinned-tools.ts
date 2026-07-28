// Pinned CLI-tool installer — SEPARATE from the code-intel engine registry in
// code-intel-engine.ts/engine-pin.ts. This installs standalone CLI binaries
// that are never registered as an MCP engine (see tldr-code below): opt-in,
// CLI-only tools that consumers shell out to directly.
//
// Mirrors engine-pin.ts's security discipline: checksum is the security
// boundary. A checksum mismatch deletes the download and THROWS — we never
// leave an unverified archive extracted on disk. A missing checksum for the
// current platform, a non-OK HTTP response, a network error, or an extraction
// failure all fail soft (return null) — the tool simply stays uninstalled and
// the caller continues.
//
// Two differences from engine-pin.ts's ensurePinnedEngine that this module
// exists to handle:
//   1. The release asset is a `.tar.xz` ARCHIVE, not a bare binary — the
//      checksum is verified against the archive, then the archive is
//      extracted and only the target binary is moved into place.
//   2. Asset naming uses Rust target triples, which don't match
//      platform.ts's platformKey() (`darwin-arm64` etc). Each descriptor
//      carries its own explicit platformKey -> {triple, sha256} map.

import { existsSync, lstatSync, type Stats } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { progressWarn } from "./colors.ts";
import { platformKey } from "./engine-pin.ts";
import { hashFileOrNull } from "./hooks-fingerprint.ts";
import { CLAUDE_DIR } from "./platform.ts";

export interface PinnedToolPlatform {
  /** Rust target triple used in the release asset filename. */
  triple: string;
  /** SHA256 hex of the `.tar.xz` archive for this platform. */
  sha256: string;
}

export interface PinnedToolDescriptor {
  id: string;
  version: string;
  /** Name of the single binary to extract and install from the archive. */
  binName: string;
  /** Release URL containing a literal `<TRIPLE>` placeholder token. */
  urlTemplate: string;
  /** platformKey() (`darwin-arm64`, …) -> {triple, sha256}. */
  platforms: Record<string, PinnedToolPlatform>;
}

// tldr-code v0.4.0 (github.com/parcadei/tldr-code) — the Rust rewrite of the
// archived llm-tldr. Its CLI (`tldr dead`, `tldr search`, …) was measured
// accurate on TypeScript; its bundled `tldr-mcp` server was measured reporting
// live symbols as dead code, so we install ONLY the `tldr` binary — never
// `tldr-mcp` — and never register this as a code-intel engine. See
// docs/tldr-cheatsheet.md and CHANGELOG.md for the measured evidence.
export const TLDR_CODE_TOOL: PinnedToolDescriptor = {
  id: "tldr-code",
  version: "0.4.0",
  binName: "tldr",
  urlTemplate:
    "https://github.com/parcadei/tldr-code/releases/download/v0.4.0/tldr-cli-<TRIPLE>.tar.xz",
  platforms: {
    "darwin-arm64": {
      triple: "aarch64-apple-darwin",
      sha256: "37b6952ce096c3135ed54d3b77c3b5d04a43b16a0920b74f59b95de05d650abf",
    },
    "darwin-x64": {
      triple: "x86_64-apple-darwin",
      sha256: "80fddf80fc0292c392f558a840fcd61f7f72dd975d0665e28efd0814e8438027",
    },
    "linux-arm64": {
      triple: "aarch64-unknown-linux-gnu",
      sha256: "cc25bcd1c62685db9c8bd25fd8e43abf93682dbe0b5d0d951b49a4e8efbc28c6",
    },
    "linux-x64": {
      triple: "x86_64-unknown-linux-gnu",
      sha256: "1455914111af163270dce630dd6c0293805c4a482c90689bd74bd9db49fb80bb",
    },
  },
};

/** Where a pinned tool binary is installed:
 *  ~/.claude/code-intel/<toolId>/<version>/<binName>. Mirrors
 *  engine-pin.ts's installedBinaryPath layout convention. */
export function pinnedToolPath(
  toolId: string,
  version: string,
  binName: string,
  claudeDir: string = CLAUDE_DIR,
): string {
  return join(claudeDir, "code-intel", toolId, version, binName);
}

/** Sidecar holding the SHA256 of the EXTRACTED binary, written at install time.
 *  The descriptor pins the archive, not its contents, so this is the only
 *  record of what we actually put on disk — ensurePinnedTool re-checks it
 *  before reusing an existing install. */
function digestSidecarPath(binaryPath: string): string {
  return `${binaryPath}.sha256`;
}

/** Best-effort musl detection. The GNU dynamic loader is absent on musl distros
 *  and a versioned musl loader is present instead; checking for the loader is
 *  cheaper and more reliable than shelling out to `ldd --version`. */
function isMuslLibc(): boolean {
  if (existsSync("/lib/ld-musl-x86_64.so.1") || existsSync("/lib/ld-musl-aarch64.so.1")) {
    return true;
  }
  // No glibc loader on either canonical path ⇒ not a glibc system.
  return !existsSync("/lib/ld-linux-x86-64.so.2") && !existsSync("/lib64/ld-linux-x86-64.so.2");
}

/** Returns the installed tldr-code binary path if it's on disk, else null.
 *  This is what consumers (deslopper, nuclear-review, security-reviewer) use
 *  to detect availability before shelling out — no network, no side effects.
 *
 *  Cheap gate only: a regular file (NOT a symlink — a symlinked binary would
 *  redirect execution somewhere unpinned) with the owner-execute bit. The full
 *  digest re-check lives in ensurePinnedTool, which runs at install time;
 *  hashing a ~55MB binary on every agent invocation is not worth the latency. */
export function tldrCodePath(claudeDir: string = CLAUDE_DIR): string | null {
  const path = pinnedToolPath(
    TLDR_CODE_TOOL.id,
    TLDR_CODE_TOOL.version,
    TLDR_CODE_TOOL.binName,
    claudeDir,
  );
  let st: Stats;
  try {
    st = lstatSync(path);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  if ((st.mode & 0o100) === 0) return null;
  return path;
}

/**
 * Download + verify + extract + install a pinned CLI tool. Opt-in only —
 * callers gate invocation on CC_PINNED_TOOLS; this function itself has no
 * env-var awareness and always attempts installation when called.
 *
 * Fail-soft (returns null, no throw): no checksum pinned for this platform, a
 * non-OK HTTP response, a network error, or an archive-extraction failure —
 * the tool simply stays uninstalled and the caller continues.
 *
 * Hard-fail (throws): the downloaded archive's bytes don't match the pinned
 * checksum. The temp archive is removed first; we never extract an unverified
 * archive or leave one on disk.
 *
 * Returns the installed binary path on success (or when it's already
 * installed).
 */
export async function ensurePinnedTool(
  tool: PinnedToolDescriptor,
  claudeDir: string = CLAUDE_DIR,
): Promise<string | null> {
  const key = platformKey();
  const plat = tool.platforms[key];
  if (!plat) {
    progressWarn(`${tool.id}: no pinned checksum for ${key} — tool not installed`);
    return null;
  }

  // Upstream ships only *-unknown-linux-GNU assets. On a musl distro (Alpine)
  // those download and checksum fine but cannot exec, so the tool would look
  // installed and fail at call time — the silent-failure mode this module
  // exists to avoid. Refuse up front instead.
  if (process.platform === "linux" && isMuslLibc()) {
    progressWarn(`${tool.id}: musl libc detected — no musl asset upstream, tool not installed`);
    return null;
  }

  const dest = pinnedToolPath(tool.id, tool.version, tool.binName, claudeDir);
  // Reuse an existing install ONLY when its bytes still match what we recorded
  // at install time. Trusting mere existence would let a corrupted, replaced,
  // or symlink-swapped binary be handed back and executed. Anything that fails
  // this check falls through and is re-downloaded and re-verified.
  const recordedDigest = await readFile(digestSidecarPath(dest), "utf8")
    .then((s) => s.trim())
    .catch(() => null);
  if (recordedDigest && (await hashFileOrNull(dest)) === recordedDigest) return dest;

  await mkdir(dirname(dest), { recursive: true });
  const tmpArchive = `${dest}.${process.pid}-${Date.now()}.tar.xz`;
  const url = tool.urlTemplate.replaceAll("<TRIPLE>", plat.triple);

  let bytes: ArrayBuffer;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      progressWarn(`${tool.id}: download failed (HTTP ${res.status}) — tool not installed`);
      return null;
    }
    bytes = await res.arrayBuffer();
  } catch (err) {
    progressWarn(`${tool.id}: download error (${(err as Error).message}) — tool not installed`);
    return null;
  }
  await writeFile(tmpArchive, new Uint8Array(bytes));

  // Checksum verification — the security boundary. A mismatch must never
  // reach extraction; delete the temp archive and throw so the failure is loud.
  const actual = await hashFileOrNull(tmpArchive);
  if (actual !== plat.sha256) {
    await rm(tmpArchive, { force: true }).catch(() => {});
    throw new Error(
      `${tool.id}: checksum mismatch for ${key} (expected ${plat.sha256}, got ${actual ?? "unreadable"}) — refusing to install`,
    );
  }

  let staging: string;
  try {
    staging = await mkdtemp(join(dirname(dest), "extract-"));
  } catch (err) {
    progressWarn(
      `${tool.id}: staging dir creation failed (${(err as Error).message}) — tool not installed`,
    );
    await rm(tmpArchive, { force: true }).catch(() => {});
    return null;
  }

  try {
    const proc = Bun.spawn(["tar", "-xf", tmpArchive, "-C", staging], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const code = await proc.exited;
    if (code !== 0) {
      progressWarn(
        `${tool.id}: archive extraction failed (tar exited ${code}) — tool not installed`,
      );
      return null;
    }

    const extractedBinary = join(staging, `tldr-cli-${plat.triple}`, tool.binName);
    if (!existsSync(extractedBinary)) {
      progressWarn(`${tool.id}: expected binary missing from archive — tool not installed`);
      return null;
    }

    await rename(extractedBinary, dest);
    await chmod(dest, 0o755);
    // Record what we actually installed so the reuse path above can verify it.
    const installedDigest = await hashFileOrNull(dest);
    if (installedDigest) {
      await writeFile(digestSidecarPath(dest), installedDigest);
    }
    return dest;
  } finally {
    await rm(tmpArchive, { force: true }).catch(() => {});
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
