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
import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CryptoHasher } from "bun";

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
  const path = join(claudeDir ?? join(homedir(), ".claude"), FINGERPRINT_FILENAME);
  if (!existsSync(path)) return null;
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as Partial<FingerprintRecord>;
    if (typeof parsed.hash !== "string") return null;
    return {
      hash: parsed.hash,
      installedAt: parsed.installedAt ?? "",
      hooksCount: typeof parsed.hooksCount === "number" ? parsed.hooksCount : 0,
    };
  } catch {
    return null;
  }
}

export async function writeFingerprint(
  settings: unknown,
  claudeDir?: string,
): Promise<FingerprintRecord> {
  const dir = claudeDir ?? join(homedir(), ".claude");
  const path = join(dir, FINGERPRINT_FILENAME);
  const tmp = `${path}.tmp`;

  const hooks =
    settings && typeof settings === "object"
      ? ((settings as Record<string, unknown>).hooks ?? {})
      : {};
  let hooksCount = 0;
  if (hooks && typeof hooks === "object") {
    for (const groups of Object.values(hooks as Record<string, unknown>)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        const entries = (group as { hooks?: unknown[] })?.hooks;
        if (Array.isArray(entries)) hooksCount += entries.length;
      }
    }
  }

  const record: FingerprintRecord = {
    hash: hashHooks(settings),
    installedAt: new Date().toISOString(),
    hooksCount,
  };
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`);
  await rename(tmp, path);
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
  const dir = claudeDir ?? join(homedir(), ".claude");
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
