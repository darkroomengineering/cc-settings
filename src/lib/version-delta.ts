// Install-summary version delta — surfaces what the user got from the
// re-install. The merger already announces specific migrations it ran (hook
// prune, statusLine reset). This module shows the human-friendly story:
// "v10.4.1 → v10.5.1 (2 versions since last install)" plus the headline
// of each version that landed.
//
// Source of truth: `~/.claude/.cc-settings-version` for the previous version,
// `src/setup.ts`'s VERSION constant for the new one, `CHANGELOG.md` for the
// titles of intermediate versions.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
}

const VERSION_HEADING_RE = /^##\s*\[(\d+\.\d+\.\d+)\](?:\s*—\s*(\d{4}-\d{2}-\d{2}))?/;

export interface SentinelInfo {
  version: string | null;
  repoPath: string | null;
}

/**
 * Read the installer's recorded version + repo path from
 * `~/.claude/.cc-settings-version`. Each field falls back to null on a missing
 * sentinel (first install), a sentinel written before that field existed, or
 * malformed JSON. Never throws. This is the single sentinel reader — both the
 * install-summary delta and version-drift detection build on it.
 */
export async function readSentinelInfo(claudeDir: string): Promise<SentinelInfo> {
  const sentinelPath = join(claudeDir, ".cc-settings-version");
  if (!existsSync(sentinelPath)) return { version: null, repoPath: null };
  try {
    const raw = await readFile(sentinelPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown; repo_path?: unknown };
    return {
      version: typeof parsed.version === "string" ? parsed.version : null,
      repoPath: typeof parsed.repo_path === "string" ? parsed.repo_path : null,
    };
  } catch {
    return { version: null, repoPath: null };
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
