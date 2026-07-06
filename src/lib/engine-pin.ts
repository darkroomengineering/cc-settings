// Pinned-binary verification for "rented" code-intelligence engines that ship
// as a downloaded static binary (e.g. codebase-memory). The defensive layer of
// the engine-indirection design: cc-settings NEVER runs an unverified binary.
// An engine installs only when the downloaded bytes match a checksum pinned in
// its descriptor for the current platform; a mismatch deletes the download and
// throws (security boundary), and a missing checksum or a network failure
// fails soft (returns null, engine simply stays uninstalled).
//
// Mirrors src/lib/hooks-fingerprint.ts: same CryptoHasher sha256, zod-validated
// on-disk record, atomicWriteJson, and control-char strip on every value echoed
// into a terminal banner.
//
// SLSA/sigstore provenance is a designed stub (verifyProvenance returns true
// with a TODO) — the gate exists now so the call site is wired; the real
// verifier lands later. Until then the checksum pin is the only enforced gate.
//
// installedBinaryPath lives HERE, not in code-intel-engine.ts, to keep the
// dependency one-directional: code-intel-engine value-imports this module and
// re-exports installedBinaryPath; this module imports only the EngineDescriptor
// TYPE back (erased at compile time — no runtime import cycle).

import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CryptoHasher } from "bun";
import { z } from "zod";
import type { EngineDescriptor } from "./code-intel-engine.ts";
import { progressWarn } from "./colors.ts";
import { hashFileOrNull } from "./hooks-fingerprint.ts";
import { atomicWriteJson } from "./json-io.ts";
import { arch, CLAUDE_DIR, platform } from "./platform.ts";

// Mirrors hooks-fingerprint.ts:stripControl — the pin record is the file the
// supply-chain threat model lets an attacker rewrite, and its fields are echoed
// into the verify-hooks banner, so a crafted value could smuggle ANSI escapes
// to disguise the alarm. Drop C0/C1 controls (incl. ESC) on read.
const stripControl = (s: string): string =>
  Array.from(s)
    .filter((c) => {
      const n = c.charCodeAt(0);
      return n > 0x1f && n !== 0x7f && (n < 0x80 || n > 0x9f);
    })
    .join("");

export const ENGINE_PIN_FILENAME = ".cc-settings-engine-pin";

// Zod schema for the pin record written to disk. Validates on read (mirrors
// FingerprintRecordSchema): a tampered record must not carry a non-64-char hash
// or smuggle control chars through the banner.
const PinRecordSchema = z.object({
  id: z.string().min(1),
  version: z.string().default("").transform(stripControl),
  platform: z.string().default("").transform(stripControl),
  sha256: z.string().length(64),
  installedAt: z.string().default("").transform(stripControl),
});

export interface PinRecord {
  id: string;
  version: string;
  platform: string;
  sha256: string;
  installedAt: string;
}

/** Platform discriminator for checksum lookup — matches the keys an engine
 *  descriptor pins its per-platform checksums under. */
export function platformKey(): string {
  return `${platform}-${arch}`;
}

/** Where a downloaded engine binary is installed:
 *  ~/.claude/code-intel/<id>/<version>/<binName>. Versioned so a pin bump
 *  lands in a fresh path and the old binary can be pruned. Only meaningful for
 *  download-method engines; callers only invoke it for those. */
export function installedBinaryPath(engine: EngineDescriptor, claudeDir: string): string {
  const version = engine.install.method === "download" ? engine.install.version : "0";
  const binName = engine.install.method === "download" ? engine.install.binName : engine.id;
  return join(claudeDir, "code-intel", engine.id, version, binName);
}

// The descriptor URL carries literal `${version}`/`${platform}`/`${arch}`
// placeholder tokens (not a JS template literal) that we substitute at install
// time. biome's noTemplateCurlyInString flags the look-alike; the tokens are
// intentional, so each substitution line is suppressed.
function expandUrl(url: string, version: string): string {
  return (
    url
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder token, not a JS template
      .replaceAll("${version}", version)
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder token, not a JS template
      .replaceAll("${platform}", platform)
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder token, not a JS template
      .replaceAll("${arch}", arch)
  );
}

// Provenance gate — STUB. Designed in now so the install path has the check
// wired; returns true until a real verifier lands.
// TODO: verify SLSA L3 provenance + sigstore cosign keyless signature for the
// downloaded binary before trusting it. The checksum pin in ensurePinnedEngine
// is the only enforced gate until this is implemented.
function verifyProvenance(_engine: EngineDescriptor, _binaryPath: string): boolean {
  return true;
}

async function writePinRecord(
  engine: EngineDescriptor,
  sha256: string,
  claudeDir: string,
): Promise<void> {
  const version = engine.install.method === "download" ? engine.install.version : "0";
  const record: PinRecord = {
    id: engine.id,
    version,
    platform: platformKey(),
    sha256,
    installedAt: new Date().toISOString(),
  };
  await atomicWriteJson(join(claudeDir, ENGINE_PIN_FILENAME), record);
}

/**
 * Download + verify + install a pinned engine binary. Download-method only.
 *
 * Fail-soft (returns null, no throw): no checksum pinned for this platform, a
 * non-OK HTTP response, or a network error — the engine simply stays
 * uninstalled and the caller continues.
 *
 * Hard-fail (throws): the downloaded bytes don't match the pinned checksum, or
 * the provenance gate rejects them. The temp download is removed first; we
 * never leave an unverified binary on disk or fall through to running it.
 *
 * Returns the installed binary path on success (or when an already-installed
 * binary already matches the pin).
 */
export async function ensurePinnedEngine(
  engine: EngineDescriptor,
  claudeDir: string = CLAUDE_DIR,
): Promise<string | null> {
  if (engine.install.method !== "download") return null;
  const { checksums, version, url } = engine.install;

  const expected = checksums[platformKey()];
  if (!expected) {
    progressWarn(`${engine.id}: no pinned checksum for ${platformKey()} — engine not installed`);
    return null;
  }

  const dest = installedBinaryPath(engine, claudeDir);
  // Already installed and matching the pin — reuse it.
  if ((await hashFileOrNull(dest)) === expected) return dest;

  await mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}-${Date.now()}.download`;

  let bytes: ArrayBuffer;
  try {
    const res = await fetch(expandUrl(url, version));
    if (!res.ok) {
      progressWarn(`${engine.id}: download failed (HTTP ${res.status}) — engine not installed`);
      return null;
    }
    bytes = await res.arrayBuffer();
  } catch (err) {
    progressWarn(`${engine.id}: download error (${(err as Error).message}) — engine not installed`);
    return null;
  }
  await writeFile(tmp, new Uint8Array(bytes));

  // Checksum verification — the security boundary. A mismatch must never reach
  // disk-as-installed; delete the temp and throw so the failure is loud.
  const actual = await hashFileOrNull(tmp);
  if (actual !== expected) {
    await rm(tmp, { force: true }).catch(() => {});
    throw new Error(
      `${engine.id}: checksum mismatch for ${platformKey()} (expected ${expected}, got ${actual ?? "unreadable"}) — refusing to install`,
    );
  }

  // Provenance gate (stubbed). Same fail-closed posture as the checksum.
  if (!verifyProvenance(engine, tmp)) {
    await rm(tmp, { force: true }).catch(() => {});
    throw new Error(`${engine.id}: provenance verification failed — refusing to install`);
  }

  await rename(tmp, dest);
  await chmod(dest, 0o755);
  await writePinRecord(engine, expected, claudeDir);
  return dest;
}

export async function readPinRecord(claudeDir: string = CLAUDE_DIR): Promise<PinRecord | null> {
  const path = join(claudeDir, ENGINE_PIN_FILENAME);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    const result = PinRecordSchema.safeParse(raw);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}

/**
 * Re-hash the installed binary against the pin record. "missing" for a
 * non-download engine (nothing is pinned — the default llm-tldr/native-ts case,
 * so verify-hooks stays silent), an absent/mismatched-id pin record, or an
 * absent binary. "mismatch" only when a pinned binary's bytes changed since
 * install — the alarm condition.
 */
export async function verifyPinnedEngine(
  engine: EngineDescriptor,
  claudeDir: string = CLAUDE_DIR,
): Promise<"match" | "mismatch" | "missing"> {
  if (engine.install.method !== "download") return "missing";
  const record = await readPinRecord(claudeDir);
  if (!record || record.id !== engine.id) return "missing";
  const actual = await hashFileOrNull(installedBinaryPath(engine, claudeDir));
  if (actual === null) return "missing";
  return actual === record.sha256 ? "match" : "mismatch";
}
