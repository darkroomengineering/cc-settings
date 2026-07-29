// Verified-download primitive shared by the two pinned-binary installers:
// engine-pin.ts (code-intel engine binaries) and pinned-tools.ts (standalone
// CLI tools). Both had independently implemented the same
// fetch → temp → checksum → cleanup state machine, which meant the security
// boundary existed in two places and a hardening applied to one would silently
// miss the other. See docs/audits/nuclear-review-2026-07-29.md F1.
//
// The callers differ only in what happens AFTER verification: engine-pin
// renames the verified file into place; pinned-tools treats it as a .tar.xz and
// lifts one binary out of it. Everything up to and including verification is
// here, so the provenance gate below covers BOTH install paths — the specific
// drift F1 identified.
//
// The verified temp file is handed back to the caller, which owns it from that
// point: move it, extract it, and remove it. This module never leaves an
// UNVERIFIED file on disk — every failure path either wrote nothing or removes
// what it wrote before returning/throwing.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { progressWarn } from "./colors.ts";
import { hashFileOrNull } from "./hooks-fingerprint.ts";

export interface VerifiedDownloadRequest {
  /** Fully-expanded absolute URL. Placeholder tokens are the caller's job. */
  url: string;
  /** Final install path. Used only to derive a sibling temp path, so the
   *  caller's rename/extract stays on one filesystem. Its parent is created. */
  dest: string;
  /** Expected SHA256 of the downloaded bytes — the security boundary. */
  expectedSha256: string;
  /** Temp-file suffix (".download", ".tar.xz"). Cosmetic; aids debugging. */
  tmpSuffix: string;
  /** Descriptor id, prefixed onto every message. */
  label: string;
  /** Completes "— <kind> not installed" in the fail-soft warnings, preserving
   *  each caller's original wording. */
  kind: "engine" | "tool";
  /** Platform discriminator, echoed in the mismatch error. Passed in rather
   *  than computed so this module needs no dependency on the descriptor
   *  modules that call it. */
  platformKey: string;
}

// Provenance gate — STUB, and deliberately the ONLY copy. Designed in now so
// both install paths have the check wired; returns true until a real verifier
// lands. Before F1's extraction this existed only on the engine path, so a real
// implementation would have left the tool path (a ~55MB third-party binary from
// a GitHub release) unverified without any warning.
// TODO: verify SLSA L3 provenance + sigstore cosign keyless signature for the
// downloaded bytes before trusting them. The checksum pin in downloadAndVerify
// is the only enforced gate until this is implemented.
function verifyProvenance(_label: string, _path: string): boolean {
  return true;
}

/**
 * Download bytes and verify them against a pinned checksum.
 *
 * Fail-soft (returns null, no throw): a non-OK HTTP response or a network
 * error — the caller simply skips installation and continues.
 *
 * Hard-fail (throws): the downloaded bytes don't match `expectedSha256`, or the
 * provenance gate rejects them. The temp file is removed first; an unverified
 * download is never left on disk for a caller to act on.
 *
 * Returns the path to the VERIFIED temp file on success. The caller owns it and
 * must move it into place and/or remove it.
 */
export async function downloadAndVerify(req: VerifiedDownloadRequest): Promise<string | null> {
  await mkdir(dirname(req.dest), { recursive: true });
  const tmp = `${req.dest}.${process.pid}-${Date.now()}${req.tmpSuffix}`;

  // Ownership of `tmp` transfers to the caller only on the success return. Until
  // then this function owns it, and the `finally` below removes it on EVERY
  // other exit — the explicit rejections above, a partial `writeFile`, or an
  // unexpected throw from hashing. Without the finally, an unverified partial
  // download could survive on disk, which this module's contract forbids.
  let handedOff = false;
  try {
    let bytes: ArrayBuffer;
    try {
      const res = await fetch(req.url);
      if (!res.ok) {
        progressWarn(
          `${req.label}: download failed (HTTP ${res.status}) — ${req.kind} not installed`,
        );
        return null;
      }
      bytes = await res.arrayBuffer();
    } catch (err) {
      progressWarn(
        `${req.label}: download error (${(err as Error).message}) — ${req.kind} not installed`,
      );
      return null;
    }
    await writeFile(tmp, new Uint8Array(bytes));

    // Checksum verification — the security boundary. A mismatch must never reach
    // the caller; throw so the failure is loud (the finally does the cleanup).
    const actual = await hashFileOrNull(tmp);
    if (actual !== req.expectedSha256) {
      throw new Error(
        `${req.label}: checksum mismatch for ${req.platformKey} (expected ${req.expectedSha256}, got ${actual ?? "unreadable"}) — refusing to install`,
      );
    }

    // Provenance gate (stubbed). Same fail-closed posture as the checksum.
    if (!verifyProvenance(req.label, tmp)) {
      throw new Error(`${req.label}: provenance verification failed — refusing to install`);
    }

    handedOff = true;
    return tmp;
  } finally {
    if (!handedOff) await rm(tmp, { force: true }).catch(() => {});
  }
}
