// Version arithmetic over the install sentinel — three concerns, one module:
//
// 1. Install-summary delta — surfaces what the user got from the re-install.
//    The merger already announces specific migrations it ran (hook prune,
//    statusLine reset). This shows the human-friendly story:
//    "v10.4.1 → v10.5.1 (2 versions since last install)" plus the headline
//    of each version that landed.
// 2. Version-drift detection for the statusline nudge (formerly
//    src/lib/version-drift.ts) — see the drift section at the bottom.
// 3. Session install-version map for the restart-pending statusline banner —
//    see the session-map section at the bottom.
//
// Source of truth: `~/.claude/.cc-settings-version` for the previous version,
// `src/setup.ts`'s VERSION constant for the new one, `CHANGELOG.md` for the
// titles of intermediate versions.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
}

const VERSION_HEADING_RE = /^##\s*\[(\d+\.\d+\.\d+)\](?:\s*—\s*(\d{4}-\d{2}-\d{2}))?/;

export interface SentinelInfo {
  version: string | null;
  repoPath: string | null;
  /** Code-intelligence engine id the install was provisioned with (e.g.
   *  "llm-tldr", "native-ts"). Null on a pre-engine sentinel — resolveEngine
   *  then falls back to the default engine. */
  engine: string | null;
  /** Auto-update enrollment decision (see src/lib/schedule.ts decideAutoUpdate).
   *  true/false = explicitly decided; null = never decided (absent from the
   *  sentinel, or written before this field existed) — NOT the same as "declined". */
  autoUpdate: boolean | null;
}

/**
 * Read the installer's recorded version + repo path + engine from
 * `~/.claude/.cc-settings-version`. Each field falls back to null on a missing
 * sentinel (first install), a sentinel written before that field existed, or
 * malformed JSON. Never throws. This is the single sentinel reader — the
 * install-summary delta, version-drift detection, and engine resolution all
 * build on it.
 */
export async function readSentinelInfo(claudeDir: string): Promise<SentinelInfo> {
  const sentinelPath = join(claudeDir, ".cc-settings-version");
  if (!existsSync(sentinelPath))
    return { version: null, repoPath: null, engine: null, autoUpdate: null };
  try {
    const raw = await readFile(sentinelPath, "utf8");
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      repo_path?: unknown;
      engine?: unknown;
      auto_update?: unknown;
    };
    return {
      version: typeof parsed.version === "string" ? parsed.version : null,
      repoPath: typeof parsed.repo_path === "string" ? parsed.repo_path : null,
      engine: typeof parsed.engine === "string" ? parsed.engine : null,
      autoUpdate: typeof parsed.auto_update === "boolean" ? parsed.auto_update : null,
    };
  } catch {
    return { version: null, repoPath: null, engine: null, autoUpdate: null };
  }
}

/**
 * The previous installer's recorded version, for the install-summary delta.
 * Convenience over {@link readSentinelInfo}; null on first install or a
 * malformed sentinel.
 */
export async function readInstalledVersion(claudeDir: string): Promise<string | null> {
  return (await readSentinelInfo(claudeDir)).version;
}

/**
 * Parse `## [X.Y.Z] — YYYY-MM-DD` version headings out of CHANGELOG text.
 * The "title" is the first `### ` h3 below the version heading, or the first
 * non-empty paragraph line if no h3 exists.
 *
 * Order: top-to-bottom (newest first, matching CHANGELOG.md convention).
 */
export function parseChangelogEntries(changelogText: string): ChangelogEntry[] {
  const lines = changelogText.split("\n");
  const entries: ChangelogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = VERSION_HEADING_RE.exec(line);
    if (!match) continue;
    const version = match[1] ?? "";
    const date = match[2] ?? "";

    // Walk forward to the first meaningful line after the version heading.
    let title = "";
    for (let j = i + 1; j < lines.length; j++) {
      const next = (lines[j] ?? "").trim();
      if (!next) continue;
      // Stop if we hit another version heading without finding a title.
      if (VERSION_HEADING_RE.test(next)) break;
      title = next.replace(/^#{2,}\s*/, "").trim();
      break;
    }

    entries.push({ version, date, title });
  }

  return entries;
}

/** Strict semver comparator over X.Y.Z (no pre-release suffix support). */
export function compareVersion(a: string, b: string): number {
  const ap = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const bp = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const av = ap[i] ?? 0;
    const bv = bp[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Filter to entries strictly after `from` (exclusive) and at or before `to`
 * (inclusive). E.g. from=10.4.1, to=10.5.1 → [10.5.0, 10.5.1].
 */
export function entriesBetween(
  entries: ChangelogEntry[],
  from: string,
  to: string,
): ChangelogEntry[] {
  return entries.filter(
    (e) => compareVersion(e.version, from) > 0 && compareVersion(e.version, to) <= 0,
  );
}

interface FormatArgs {
  prev: string | null;
  current: string;
  entries: ChangelogEntry[];
}

/**
 * Format the user-facing delta message. Returns null when there's nothing
 * to say (same version, or first install with empty changelog).
 */
export function formatVersionDelta({ prev, current, entries }: FormatArgs): string | null {
  if (!prev) {
    return `cc-settings: first install at v${current}`;
  }
  const cmp = compareVersion(prev, current);
  if (cmp === 0) return null; // re-install of same version
  if (cmp > 0) {
    // Downgrade — rare but possible (rollback scenarios). Mention it.
    return `cc-settings: v${prev} → v${current} (downgrade)`;
  }
  const lines = [
    `cc-settings: v${prev} → v${current} (${entries.length} version(s) since last install)`,
  ];
  for (const e of entries) {
    lines.push(`  • v${e.version}: ${e.title || "(no title)"}`);
  }
  return lines.join("\n");
}

/**
 * Convenience: parse changelog + format. The caller passes `prev` explicitly
 * because the install flow overwrites `~/.claude/.cc-settings-version` mid-run
 * — capture it BEFORE writeVersionSentinel(), then call this. Returns null
 * when there's nothing to print.
 */
export async function buildVersionDelta(
  prev: string | null,
  current: string,
  changelogPath: string,
): Promise<string | null> {
  let entries: ChangelogEntry[] = [];
  if (existsSync(changelogPath)) {
    try {
      entries = parseChangelogEntries(await readFile(changelogPath, "utf8"));
    } catch {
      entries = [];
    }
  }
  const between = prev ? entriesBetween(entries, prev, current) : [];
  return formatVersionDelta({ prev, current, entries: between });
}

// --- Version-drift detection (statusline nudge) -----------------------------
//
// The installer stamps ~/.claude/.cc-settings-version with the installed
// version AND the repo path it was installed from. After `git pull` bumps the
// VERSION constant in the repo's src/setup.ts but before the user re-runs
// setup.sh, installed < packaged — the install is stale. SessionStart computes
// this once and caches it; the statusline renders a nudge from the cached flag
// (hot-path safe).
//
// Every reader fails soft (returns null / not-stale): a missing sentinel, a
// sentinel without repo_path (installed before this feature), a deleted clone,
// or malformed input all resolve to "no nudge".

export interface DriftResult {
  stale: boolean;
  installed: string | null;
  packaged: string | null;
}

// Match `const VERSION = "11.12.0"` in the repo's src/setup.ts. Anchored on
// `const VERSION` so a stray `VERSION = ...` in a comment can't shadow it.
const VERSION_CONST_RE = /\bconst VERSION\s*=\s*["'](\d+\.\d+\.\d+)["']/;

/** Read the repo's packaged VERSION constant from <repoPath>/src/setup.ts.
 *  Returns null if the repo is gone or the constant can't be parsed. Never throws. */
export async function readPackagedVersion(repoPath: string | null): Promise<string | null> {
  if (!repoPath) return null;
  const setupPath = join(repoPath, "src", "setup.ts");
  if (!existsSync(setupPath)) return null;
  try {
    const src = await readFile(setupPath, "utf8");
    const m = VERSION_CONST_RE.exec(src);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Stale when both versions are known and packaged is strictly newer. */
export function computeDrift(installed: string | null, packaged: string | null): DriftResult {
  const stale = installed !== null && packaged !== null && compareVersion(packaged, installed) > 0;
  return { stale, installed, packaged };
}

// --- Session install-version map (restart-pending banner) -------------------

/** State file mapping session_id → the cc-settings version that session's
 *  PROCESS last started with. The statusline compares an entry against the
 *  currently installed version to decide whether to show the
 *  "⟳ v<X> installed — restart Claude to apply" banner. */
export const SESSION_INSTALL_STATE = "session-install-version.json";

export const SESSION_MAP_CAP = 20;

/** Single shape definition for the state file — BOTH readers (session-start.ts
 *  and statusline.ts) must validate through this so a corrupted/partial write
 *  degrades to "absent" in every consumer, not just one. */
export const SessionInstallMapSchema = z.record(
  z.string(),
  z.object({ v: z.string(), t: z.number() }),
);

export type SessionInstallMap = z.infer<typeof SessionInstallMapSchema>;

/**
 * Set (or refresh) a session's recorded install version and prune the map to
 * the SESSION_MAP_CAP most recent entries. Pure — callers own the state IO.
 *
 * Refreshing on EVERY SessionStart (not just first statusline render) is what
 * makes the banner process-scoped: Claude Code keeps the same session_id when
 * a conversation is resumed, so a first-render-only record would pin a resumed
 * session to the version it saw days ago and the banner could never clear.
 *
 * Concurrency: callers do read-then-atomic-rename against a shared multi-
 * session file with no lock — two concurrent FIRST writes can drop one entry
 * (last-write-wins). Intentional: the dropped session's statusline fallback
 * re-writes on its next render, and the file only gates a cosmetic banner.
 * Don't reach for a lock here.
 */
export function refreshSessionInstallMap(
  map: SessionInstallMap,
  sessionId: string,
  version: string,
  now: number,
): SessionInstallMap {
  const next: SessionInstallMap = { ...map, [sessionId]: { v: version, t: now } };
  return Object.fromEntries(
    Object.entries(next)
      .sort((a, b) => b[1].t - a[1].t)
      .slice(0, SESSION_MAP_CAP),
  );
}
