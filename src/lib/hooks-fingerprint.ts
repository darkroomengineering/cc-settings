// Hooks-block and plugin-key fingerprint. Setup writes a SHA256 of the
// canonicalized hooks section, plus a second SHA256 of the plugin keys
// (enabledPlugins, extraKnownMarketplaces, pluginConfigs), after install; the SessionStart verify-hook re-hashes on every
// session and warns on mismatch. Defense against supply-chain malware that
// injects hooks into ~/.claude/settings.json post-install (Shai-Hulud worm
// pattern reported May 2026).
//
// The user can deliberately mutate hooks (custom entries are preserved by the
// installer's merger). Mismatch isn't proof of compromise — it's a signal to
// run `bun run audit:hooks`, review the diff, and either revert the bad entry
// or re-run setup.sh to refresh the fingerprint.

import { existsSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CryptoHasher } from "bun";
import { z } from "zod";
import { iterCommandHooks } from "./hook-command.ts";
import { readValidatedState } from "./hook-runtime.ts";
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
  // Absent in records written before plugin keys were fingerprinted. Verify
  // skips the plugin comparison for such a record rather than alarming; the
  // next setup run writes it.
  pluginsHash: z.string().min(1).optional(),
  // Per-entry SHA256 of each plugin-key entry at the last setup run, so the
  // mismatch warning lists only what changed since then. Absent in records
  // written before this existed.
  pluginEntries: z.record(z.string(), z.record(z.string(), z.string())).optional(),
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

/** Top-level settings keys that decide which plugin code Claude Code loads. */
export const PLUGIN_KEYS = ["enabledPlugins", "extraKnownMarketplaces", "pluginConfigs"] as const;

export function hashPluginKeys(settings: unknown): string {
  const source =
    settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const picked: Record<string, unknown> = {};
  for (const key of PLUGIN_KEYS) {
    picked[key] = source[key] ?? {};
  }
  const hasher = new CryptoHasher("sha256");
  hasher.update(canonicalize(picked));
  return hasher.digest("hex");
}

/** First cc-settings version whose setup writes `pluginsHash`. A record without
 *  it on an install at or past this version was stripped, not written by an
 *  older setup. */
export const PLUGIN_FINGERPRINT_SINCE = "15.45.3";

function versionAtLeast(version: string, min: string): boolean {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  if (a.length !== 3 || a.some((n) => !Number.isInteger(n))) return false;
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

async function readInstalledVersion(dir: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dir, ".cc-settings-version"), "utf8"));
    const v = (parsed as { version?: unknown } | null)?.version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

const MAX_DIFF_LINES = 10;

const sha256 = (text: string): string => {
  const hasher = new CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
};

const asMap = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** key -> entry name -> SHA256 of the entry's canonical JSON, for each plugin key. */
export type PluginEntrySnapshot = Record<string, Record<string, string>>;

export function snapshotPluginEntries(settings: unknown): PluginEntrySnapshot {
  const source = asMap(settings);
  const out: PluginEntrySnapshot = {};
  for (const key of PLUGIN_KEYS) {
    out[key] = Object.fromEntries(
      Object.entries(asMap(source[key])).map(([name, value]) => [
        name,
        sha256(canonicalize(value)),
      ]),
    );
  }
  return out;
}

/** Plugin-key entries added, removed, or changed since the last setup run.
 *  `snapshot` is the per-entry record setup stored; a record from before it
 *  existed falls back to the team's contribution at install (`team_settings` in
 *  the settings baseline), which lists every user-owned entry as added. Names
 *  are attacker-controlled text, so control characters are stripped and each
 *  line is length-capped. */
export async function diffPluginEntries(
  current: unknown,
  dir: string,
  snapshot?: PluginEntrySnapshot,
): Promise<string[]> {
  let was = snapshot;
  if (!was) {
    let team: unknown = {};
    try {
      const baseline: unknown = JSON.parse(
        await readFile(join(dir, ".cc-settings-baseline.json"), "utf8"),
      );
      team = (baseline as { team_settings?: unknown } | null)?.team_settings ?? {};
    } catch {
      // No baseline: every entry reads as added.
    }
    was = snapshotPluginEntries(team);
  }
  const now = snapshotPluginEntries(current);
  const lines: string[] = [];
  for (const key of PLUGIN_KEYS) {
    const before = was[key] ?? {};
    const after = now[key] ?? {};
    for (const name of new Set([...Object.keys(after), ...Object.keys(before)])) {
      let how: string | null = null;
      if (!(name in before)) how = "added";
      else if (!(name in after)) how = "removed";
      else if (after[name] !== before[name]) how = "changed";
      if (how) lines.push(`${key}: ${stripControl(name).slice(0, 80)} (${how})`);
    }
  }
  if (lines.length > MAX_DIFF_LINES) {
    const more = lines.length - MAX_DIFF_LINES;
    return [...lines.slice(0, MAX_DIFF_LINES), `... and ${more} more`];
  }
  return lines;
}

export interface FingerprintRecord {
  hash: string;
  installedAt: string;
  hooksCount: number;
  pluginsHash?: string;
  pluginEntries?: PluginEntrySnapshot;
}

export async function readFingerprint(claudeDir?: string): Promise<FingerprintRecord | null> {
  // Validated through the zod schema. Mirrors status.ts:35 — field values are
  // echoed into the session-start warning banner, so they must be validated
  // strings, not trusted as-cast. Missing/unreadable/malformed all degrade to
  // null (treated as "no fingerprint yet") — see readValidatedState/readState.
  return readValidatedState(
    FINGERPRINT_FILENAME,
    FingerprintRecordSchema,
    null,
    claudeDir ?? CLAUDE_DIR,
  );
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
    pluginsHash: hashPluginKeys(settings),
    pluginEntries: snapshotPluginEntries(settings),
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
  /** Which fingerprinted parts differ from the install-time record. */
  changed: Array<"hooks" | "plugins">;
  /** False when the stored record predates plugin-key fingerprinting. */
  pluginsCovered: boolean;
  /** The record lacks `pluginsHash` although the install is recent enough to
   *  have written it. */
  pluginHashStripped: boolean;
  /** Plugin-key entries differing from the team contribution (capped). */
  pluginDiff: string[];
}

export async function verifyAgainstSettings(
  settingsPath?: string,
  claudeDir?: string,
): Promise<VerifyResult> {
  const dir = claudeDir ?? CLAUDE_DIR;
  const sPath = settingsPath ?? join(dir, "settings.json");
  if (!existsSync(sPath)) {
    return {
      status: "missing-settings",
      expected: null,
      actual: null,
      installedAt: null,
      changed: [],
      pluginsCovered: false,
      pluginHashStripped: false,
      pluginDiff: [],
    };
  }
  const record = await readFingerprint(dir);
  if (!record) {
    return {
      status: "missing-fingerprint",
      expected: null,
      actual: null,
      installedAt: null,
      changed: [],
      pluginsCovered: false,
      pluginHashStripped: false,
      pluginDiff: [],
    };
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
      changed: ["hooks", "plugins"],
      pluginsCovered: record.pluginsHash !== undefined,
      pluginHashStripped: false,
      pluginDiff: [],
    };
  }
  const actual = hashHooks(parsed);
  const changed: Array<"hooks" | "plugins"> = [];
  if (actual !== record.hash) changed.push("hooks");
  let pluginHashStripped = false;
  if (record.pluginsHash !== undefined) {
    if (hashPluginKeys(parsed) !== record.pluginsHash) changed.push("plugins");
  } else {
    const installed = await readInstalledVersion(dir);
    pluginHashStripped = installed !== null && versionAtLeast(installed, PLUGIN_FINGERPRINT_SINCE);
    if (pluginHashStripped) changed.push("plugins");
  }
  return {
    status: changed.length === 0 ? "match" : "mismatch",
    expected: record.hash,
    actual,
    installedAt: record.installedAt,
    changed,
    pluginsCovered: record.pluginsHash !== undefined,
    pluginHashStripped,
    pluginDiff: changed.includes("plugins")
      ? await diffPluginEntries(parsed, dir, record.pluginEntries)
      : [],
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
// setup.ts writes a SHA256 manifest of every installed runtime source and
// production dependency right after installTsSources; verify-hooks.ts
// re-checks it at SessionStart before importing dependency-backed modules, and
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
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    const data = await readFile(path);
    const hasher = new CryptoHasher("sha256");
    hasher.update(data);
    return hasher.digest("hex");
  } catch {
    return null;
  }
}

/** List executable TypeScript plus every production dependency file.
 * Dependency contents are all in scope because Bun may load package metadata,
 * JavaScript, maps, or declarations while resolving an import. Symlinks are
 * returned as candidates so hashing rejects them instead of following them. */
async function walkIntegrityFiles(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const dependencyFile = rel === "node_modules" || rel.startsWith("node_modules/");
    if (entry.isSymbolicLink()) {
      if (dependencyFile || entry.name.endsWith(".ts")) out.push(rel);
      continue;
    }
    if (entry.isDirectory()) {
      out.push(...(await walkIntegrityFiles(join(dir, entry.name), rel)));
    } else if (entry.isFile() && (dependencyFile || entry.name.endsWith(".ts"))) {
      out.push(rel);
    }
  }
  return out.sort();
}

/** Hash the explicitly installed runtime paths plus the complete production
 * dependency tree. Recursive live discovery belongs to verification, where
 * extra files are reported as unmanifested instead of being adopted. */
export async function writeSrcManifest(
  installedSrcDir: string,
  claudeDir?: string,
  managedRelativePaths?: readonly string[],
): Promise<SrcManifestRecord> {
  const dir = claudeDir ?? CLAUDE_DIR;
  const files: Record<string, string> = {};
  const dependencyDir = join(installedSrcDir, "node_modules");
  const dependencyPaths = existsSync(dependencyDir)
    ? await walkIntegrityFiles(dependencyDir, "node_modules")
    : [];
  const selectedPaths = managedRelativePaths
    ? [...managedRelativePaths, ...dependencyPaths]
    : await walkIntegrityFiles(installedSrcDir);
  for (const rel of [...new Set(selectedPaths)].sort()) {
    if (rel.startsWith("/") || rel.split(/[/\\]/).includes("..")) {
      throw new Error(`Invalid managed runtime manifest path: ${rel}`);
    }
    const hash = await hashFileOrNull(join(installedSrcDir, rel));
    if (!hash) throw new Error(`Missing or unsafe managed runtime manifest file: ${rel}`);
    files[rel] = hash;
  }
  const record: SrcManifestRecord = { files, installedAt: new Date().toISOString() };
  await atomicWriteJson(join(dir, SRC_MANIFEST_FILENAME), record);
  return record;
}

export async function readSrcManifest(claudeDir?: string): Promise<SrcManifestRecord | null> {
  // Route through SrcManifestRecordSchema: validates types, rejects path
  // traversal (the .refine()), and strips control chars from installedAt.
  // Mirrors readFingerprint's FingerprintRecordSchema.safeParse pattern.
  return readValidatedState(
    SRC_MANIFEST_FILENAME,
    SrcManifestRecordSchema,
    null,
    claudeDir ?? CLAUDE_DIR,
  );
}

export interface SrcVerifyResult {
  status: "ok" | "missing" | "mismatch";
  /** Manifested files whose content changed — or disappeared — since install. */
  changed: string[];
  /** Runtime files on disk under ~/.claude/src that the install never wrote. */
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
  const onDisk = existsSync(srcDir) ? await walkIntegrityFiles(srcDir) : [];

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
