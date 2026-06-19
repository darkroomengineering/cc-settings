// Hooks-block fingerprint. Setup writes a SHA256 of the canonicalized hooks
// section after install; the SessionStart verify-hook re-hashes on every
// session and warns on mismatch. Defense against supply-chain malware that
// injects hooks into ~/.claude/settings.json post-install (Shai-Hulud worm
// pattern reported May 2026).
//
// The user can deliberately mutate hooks (custom entries are preserved by the
// installer's merger). Mismatch isn't proof of compromise — it's a signal to
// run `bun run audit:hooks`, review the diff, and either revert the bad entry
// or re-run setup.sh to refresh the fingerprint.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CryptoHasher } from "bun";
import { z } from "zod";
import { iterCommandHooks } from "./hook-command.ts";
import { atomicWriteJson } from "./json-io.ts";
import { CLAUDE_DIR } from "./platform.ts";

// `installedAt` is echoed verbatim into the terminal warning banner, and the
// fingerprint file is exactly what the Shai-Hulud threat model lets an attacker
// rewrite — so a crafted value could inject ANSI escapes to disguise the alarm.
// Strip control characters (incl. ESC) on read.
const stripControl = (s: string): string =>
  Array.from(s)
    .filter((c) => {
      const n = c.charCodeAt(0);
      return n > 0x1f && n !== 0x7f && (n < 0x80 || n > 0x9f); // drop C0/C1 controls
    })
    .join("");

// Zod schema for the fingerprint record written to disk.
const FingerprintRecordSchema = z.object({
  hash: z.string().min(1),
  installedAt: z.string().default("").transform(stripControl),
  hooksCount: z.number().int().nonnegative().default(0),
});

export const FINGERPRINT_FILENAME = ".cc-settings-hooks-fingerprint";

// Stable JSON serialization: sort object keys recursively, no whitespace.
// JSON.stringify by itself preserves insertion order, which would let key
// reorders trip the fingerprint with no semantic change.
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

export function hashHooks(settings: unknown): string {
  if (!settings || typeof settings !== "object") return hashHooks({ hooks: {} });
  const hooks = (settings as Record<string, unknown>).hooks ?? {};
  const canonical = canonicalize(hooks);
  const hasher = new CryptoHasher("sha256");
  hasher.update(canonical);
  return hasher.digest("hex");
}

export interface FingerprintRecord {
  hash: string;
  installedAt: string;
  hooksCount: number;
}

export async function readFingerprint(claudeDir?: string): Promise<FingerprintRecord | null> {
  const path = join(claudeDir ?? CLAUDE_DIR, FINGERPRINT_FILENAME);
  if (!existsSync(path)) return null;
  try {
    const text = await readFile(path, "utf8");
    const raw = JSON.parse(text);
    // Validate through the zod schema. Mirrors status.ts:35 — field values are
    // echoed into the session-start warning banner, so they must be validated
    // strings, not trusted as-cast. On failure return null (treat as missing).
    const result = FingerprintRecordSchema.safeParse(raw);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}

export async function writeFingerprint(
  settings: unknown,
  claudeDir?: string,
): Promise<FingerprintRecord> {
  const dir = claudeDir ?? CLAUDE_DIR;
  const path = join(dir, FINGERPRINT_FILENAME);

  // Count command hooks via the shared iterCommandHooks walk (fail-open:
  // never throws on malformed input). This replaces the hand-rolled walk.
  const hooksCount = [...iterCommandHooks(settings)].length;

  const record: FingerprintRecord = {
    hash: hashHooks(settings),
    installedAt: new Date().toISOString(),
    hooksCount,
  };
  await atomicWriteJson(path, record);
  return record;
}

// Verify result for the SessionStart hook — caller decides what to print.
export interface VerifyResult {
  status: "match" | "mismatch" | "missing-fingerprint" | "missing-settings";
  expected: string | null;
  actual: string | null;
  installedAt: string | null;
}

export async function verifyAgainstSettings(
  settingsPath?: string,
  claudeDir?: string,
): Promise<VerifyResult> {
  const dir = claudeDir ?? CLAUDE_DIR;
  const sPath = settingsPath ?? join(dir, "settings.json");
  if (!existsSync(sPath)) {
    return { status: "missing-settings", expected: null, actual: null, installedAt: null };
  }
  const record = await readFingerprint(dir);
  if (!record) {
    return { status: "missing-fingerprint", expected: null, actual: null, installedAt: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(sPath, "utf8"));
  } catch {
    // Malformed JSON is a separate problem — surface as mismatch so the user
    // notices something is off and investigates.
    return {
      status: "mismatch",
      expected: record.hash,
      actual: null,
      installedAt: record.installedAt,
    };
  }
  const actual = hashHooks(parsed);
  return {
    status: actual === record.hash ? "match" : "mismatch",
    expected: record.hash,
    actual,
    installedAt: record.installedAt,
  };
}

// --- Installed-src content manifest ----------------------------------------
//
// The hooks fingerprint above covers ONLY the `hooks` block of settings.json —
// it says nothing about the CONTENT of the scripts those hooks point at. Two
// bypasses motivated this second layer (see SECURITY.md):
//   (a) malware drops a new file under ~/.claude/src/{hooks,scripts,lib}/ and
//       registers it — path-shaped trust in audit-hooks would have called it
//       "trusted" and downgraded the fingerprint alarm;
//   (b) malware appends a payload to an already-registered shipped script —
//       settings.json is untouched, so the hooks fingerprint never trips.
// setup.ts writes a SHA256 manifest of every installed src/**/*.ts right after
// installTsSources; verify-hooks.ts re-checks it at SessionStart and
// audit-hooks.ts gates "trusted" on it. Like the fingerprint, the manifest is
// refreshed ONLY by setup.sh — never by the auditor or the verify hook — so
// malware can't whitelist itself.

export const SRC_MANIFEST_FILENAME = ".cc-settings-src-manifest";

export interface SrcManifestRecord {
  /** Posix-style path relative to ~/.claude/src → SHA256 hex of file content. */
  files: Record<string, string>;
  installedAt: string;
}

// Zod schema for the src manifest written by setup.ts. Validates on read to
// close the Shai-Hulud attack vector: a tampered manifest must not point
// outside the src tree or carry non-string hashes. The .refine() enforces the
// path-traversal guard; sibling FingerprintRecordSchema does the same for the
// hooks fingerprint.
const SrcManifestRecordSchema = z.object({
  files: z
    .record(z.string(), z.string())
    .refine(
      (files) =>
        Object.entries(files).every(
          ([rel]) => !rel.startsWith("/") && !rel.split(/[/\\]/).includes(".."),
        ),
      { message: "manifest contains path traversal" },
    ),
  installedAt: z.string().default("").transform(stripControl),
});

/** SHA256 hex of a file's content, or null when it can't be read. */
export async function hashFileOrNull(path: string): Promise<string | null> {
  try {
    const data = await readFile(path);
    const hasher = new CryptoHasher("sha256");
    hasher.update(data);
    return hasher.digest("hex");
  } catch {
    return null;
  }
}

/** Recursively list .ts files under `dir` as sorted posix-style relative paths.
 *  Skips node_modules — it is symlinked back to the source repo at install
 *  time and is explicitly out of the manifest's threat coverage. */
async function walkTsFiles(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await walkTsFiles(join(dir, entry.name), rel)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(rel);
    }
  }
  return out.sort();
}

/** Hash every .ts file under `installedSrcDir` and persist the manifest next
 *  to the hooks fingerprint (atomic write, same convention). Called by
 *  setup.ts immediately after installTsSources. */
export async function writeSrcManifest(
  installedSrcDir: string,
  claudeDir?: string,
): Promise<SrcManifestRecord> {
  const dir = claudeDir ?? CLAUDE_DIR;
  const files: Record<string, string> = {};
  for (const rel of await walkTsFiles(installedSrcDir)) {
    const hash = await hashFileOrNull(join(installedSrcDir, rel));
    if (hash) files[rel] = hash;
  }
  const record: SrcManifestRecord = { files, installedAt: new Date().toISOString() };
  await atomicWriteJson(join(dir, SRC_MANIFEST_FILENAME), record);
  return record;
}

export async function readSrcManifest(claudeDir?: string): Promise<SrcManifestRecord | null> {
  const path = join(claudeDir ?? CLAUDE_DIR, SRC_MANIFEST_FILENAME);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    // Route through SrcManifestRecordSchema: validates types, rejects path
    // traversal (the .refine()), and strips control chars from installedAt.
    // Mirrors readFingerprint's FingerprintRecordSchema.safeParse pattern.
    const result = SrcManifestRecordSchema.safeParse(raw);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}

export interface SrcVerifyResult {
  status: "ok" | "missing" | "mismatch";
  /** Manifested files whose content changed — or disappeared — since install. */
  changed: string[];
  /** .ts files on disk under ~/.claude/src that the install never wrote. */
  unmanifested: string[];
}

/** Re-hash the installed src tree against the manifest. "missing" = no
 *  manifest yet (pre-manifest install) — callers treat that as a soft state,
 *  not an alarm. Any read error on an individual file counts as changed. */
export async function verifySrcManifest(claudeDir?: string): Promise<SrcVerifyResult> {
  const dir = claudeDir ?? CLAUDE_DIR;
  const manifest = await readSrcManifest(dir);
  if (!manifest) return { status: "missing", changed: [], unmanifested: [] };

  const srcDir = join(dir, "src");
  const onDisk = existsSync(srcDir) ? await walkTsFiles(srcDir) : [];

  const changed: string[] = [];
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const actual = await hashFileOrNull(join(srcDir, rel));
    if (actual !== expected) changed.push(rel);
  }
  const unmanifested = onDisk.filter((rel) => !(rel in manifest.files));

  return {
    status: changed.length === 0 && unmanifested.length === 0 ? "ok" : "mismatch",
    changed,
    unmanifested,
  };
}
