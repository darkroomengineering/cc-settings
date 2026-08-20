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
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { atomicWriteJson } from "./json-io.ts";

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
}

const VERSION_HEADING_RE = /^##\s*\[(\d+\.\d+\.\d+)\](?:\s*—\s*(\d{4}-\d{2}-\d{2}))?/;

/**
 * Canonical schema for `~/.claude/.cc-settings-version` — the ONE definition of
 * every field the installer writes (see writeVersionSentinel in setup.ts).
 * Every consumer (gatherStatus in status.ts, readSentinelInfo below) reads
 * through this rather than modeling its own subset of the file.
 *
 * Loose (z.looseObject) AND per-field `.catch(undefined)`, deliberately:
 *   - z.looseObject lets an unrecognized top-level key (a field added by a
 *     NEWER installer than this code) pass through instead of failing.
 *   - Per-field .catch(undefined) means a single field of the wrong type
 *     degrades to "absent" for THAT field only, instead of invalidating the
 *     whole file — an older sentinel with one stale/hand-edited field must
 *     not blank out an otherwise-good version.
 * Only a non-object top level (corrupt JSON, or JSON that parses to a
 * primitive/array) fails outright — readSentinel() treats that as "absent",
 * same as a missing file.
 */
export const SentinelSchema = z.looseObject({
  version: z.string().optional().catch(undefined),
  installed_at: z.string().optional().catch(undefined),
  repo_path: z.string().optional().catch(undefined),
  profile: z.enum(["full", "light"]).optional().catch(undefined),
  engine: z.string().optional().catch(undefined),
  engine_explicit: z.boolean().optional().catch(undefined),
  mcp_written: z.record(z.string(), z.unknown()).optional().catch(undefined),
  managed_files: z.record(z.string(), z.string()).optional().catch(undefined),
  managed_files_manifest_version: z.number().int().positive().optional().catch(undefined),
  managed_files_state: z.enum(["managed-absent"]).optional().catch(undefined),
  auto_update: z.boolean().optional().catch(undefined),
});

export type Sentinel = z.infer<typeof SentinelSchema>;

const SENTINEL_SHA256 = /^[a-f0-9]{64}$/i;

function isSafeManagedFilePath(path: string): boolean {
  return (
    path.length > 0 &&
    path !== "." &&
    !isAbsolute(path) &&
    !/^[A-Za-z]:[\\/]/.test(path) &&
    !path.split(/[\\/]+/).includes("..")
  );
}

const StrictManagedFilesSchema = z
  .record(z.string(), z.string().regex(SENTINEL_SHA256))
  .superRefine((files, context) => {
    for (const path of Object.keys(files)) {
      if (!isSafeManagedFilePath(path)) {
        context.addIssue({
          code: "custom",
          message: `unsafe managed file path: ${path}`,
          path: [path],
        });
      }
    }
  });

/** Strict ownership view used only before destructive Claude operations. */
export const DestructiveSentinelSchema = SentinelSchema.extend({
  profile: z.enum(["full", "light"]).optional(),
  mcp_written: z.record(z.string(), z.unknown()).optional(),
  managed_files: StrictManagedFilesSchema.optional(),
  managed_files_manifest_version: z.number().int().positive().optional(),
  managed_files_state: z.enum(["managed-absent"]).optional(),
}).superRefine((sentinel, context) => {
  if (
    sentinel.managed_files_state === "managed-absent" &&
    (sentinel.managed_files !== undefined || sentinel.managed_files_manifest_version !== undefined)
  ) {
    context.addIssue({
      code: "custom",
      message: "managed-absent sentinel cannot claim managed file ownership",
    });
  }
});

/**
 * Parse `~/.claude/.cc-settings-version` against {@link SentinelSchema}. The
 * single low-level sentinel reader — every other reader (readSentinelInfo
 * below, gatherStatus in status.ts) builds on this instead of re-parsing the
 * file itself. Returns `{}` (every field undefined) on a missing sentinel,
 * malformed JSON, or a top-level shape that isn't an object. Never throws.
 */
export async function readSentinel(claudeDir: string): Promise<Sentinel> {
  const sentinelPath = join(claudeDir, ".cc-settings-version");
  if (!existsSync(sentinelPath)) return {};
  try {
    const parsed = JSON.parse(await readFile(sentinelPath, "utf8"));
    const result = SentinelSchema.safeParse(parsed);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

/**
 * Read ownership state for uninstall. Missing is a supported legacy state;
 * an existing malformed sentinel is not, because destructive callers cannot
 * safely infer ownership from corrupt data.
 */
export async function readDestructiveSentinel(claudeDir: string): Promise<Sentinel | null> {
  const sentinelPath = join(claudeDir, ".cc-settings-version");
  if (!existsSync(sentinelPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(sentinelPath, "utf8"));
  } catch (cause) {
    throw new Error(`Invalid Claude ownership sentinel JSON: ${sentinelPath}`, { cause });
  }
  const result = DestructiveSentinelSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid Claude ownership sentinel: ${sentinelPath}: ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
  return result.data;
}

/**
 * Write `~/.claude/.cc-settings-version` through the shared {@link Sentinel}
 * shape — the single sentinel writer, called from src/setup.ts's
 * writeVersionSentinel(). Keeps the on-disk field set in one typed place
 * instead of an anonymous object literal.
 */
export async function writeSentinel(claudeDir: string, data: Sentinel): Promise<void> {
  await atomicWriteJson(join(claudeDir, ".cc-settings-version"), data);
}

export interface SentinelInfo {
  version: string | null;
  repoPath: string | null;
  profile: "full" | "light" | null;
  /** Code-intelligence engine id the install was provisioned with (e.g.
   *  "llm-tldr", "native-ts"). Null on a pre-engine sentinel — resolveEngine
   *  then falls back to the default engine. */
  engine: string | null;
  /** Whether `engine` was an EXPLICIT choice (env override, or a sentinel that
   *  was itself explicit) rather than just the default at stamp time. Defaults
   *  to false when absent — load-bearing: every pre-existing sentinel (written
   *  before this field existed) is treated as implicit, so a changed
   *  DEFAULT_ENGINE_ID reaches it on the next resolveEngine() call instead of
   *  being pinned forever. See resolveEngine in code-intel-engine.ts.
   *
   *  THREE-STATE, and the distinction is load-bearing:
   *    true  — a deliberate choice; honour `engine`.
   *    false — definitively NOT a choice; a v12.10.0+ install stamped the
   *            default. Let a changed DEFAULT_ENGINE_ID through.
   *    null  — the field is ABSENT, i.e. a sentinel written before v12.10.0.
   *            Only then does resolveEngine infer intent from the engine id.
   *  Collapsing null into false would make every fresh implicit install look
   *  legacy and re-pin whatever the default happened to be. */
  engineExplicit: boolean | null;
  /** Exact snapshot of what this install wrote to ~/.claude.json's
   *  engine-managed MCP server(s) (keyed by server name, e.g. "tldr"), so a
   *  later install can recognize its own PRIOR output as stale even after the
   *  live ENGINES registry's serverInstructions text has since changed. Null
   *  on a sentinel written before this field existed. */
  mcpWritten: Record<string, unknown> | null;
  /** SHA-256 hashes keyed by safe paths relative to ~/.claude. Null for
   *  sentinels written before content-aware file ownership was introduced. */
  managedFiles: Record<string, string> | null;
  /** Auto-update enrollment decision (see src/lib/schedule.ts decideAutoUpdate).
   *  true/false = explicitly decided; null = never decided (absent from the
   *  sentinel, or written before this field existed) — NOT the same as "declined". */
  autoUpdate: boolean | null;
}

/**
 * Read the installer's recorded version + repo path + engine from
 * `~/.claude/.cc-settings-version`, mapped from {@link readSentinel}'s optional
 * fields to explicit nulls (this module's older, null-based convention — kept
 * as-is since three call sites and their tests already depend on it). Each
 * field falls back to null on a missing sentinel (first install), a sentinel
 * written before that field existed, or malformed JSON. Never throws. The
 * install-summary delta, version-drift detection, and engine resolution all
 * build on this.
 */
export async function readSentinelInfo(claudeDir: string): Promise<SentinelInfo> {
  const s = await readSentinel(claudeDir);
  return {
    version: s.version ?? null,
    repoPath: s.repo_path ?? null,
    profile: s.profile ?? null,
    engine: s.engine ?? null,
    engineExplicit: s.engine_explicit ?? null,
    mcpWritten: s.mcp_written ?? null,
    managedFiles: s.managed_files ?? null,
    autoUpdate: s.auto_update ?? null,
  };
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
 * Flatten the inline markdown a CHANGELOG title may carry, so the install
 * summary prints prose instead of source. The title lands in a terminal, where
 * `[text](https://…)` is noise and the URL is unclickable.
 *
 * Deliberately narrow — links/images, bold, and inline code only. `*` and `_`
 * emphasis are LEFT ALONE: changelog prose is full of globs (`*.md`) and
 * snake_case identifiers (`mcp_written`), and an emphasis stripper mangles
 * those far more often than it un-italicises anything.
 */
export function stripInlineMarkdown(text: string): string {
  return (
    text
      // [text](url) and ![alt](url). The URL matcher allows ONE level of nested
      // parens — Wikipedia/MDN links like `.../Function_(mathematics)` are the
      // realistic case, and a flat `[^)]*` stops at the inner `)` and leaves a
      // stray `)` glued to the link text. The alternation is unambiguous (its two
      // branches can't match the same first character), so it can't backtrack.
      .replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold**
      .replace(/__([^_]+)__/g, "$1") // __bold__
      // `code`
      .replace(/`([^`]+)`/g, "$1")
  );
}

/**
 * Parse `## [X.Y.Z] — YYYY-MM-DD` version headings out of CHANGELOG text.
 * The "title" is the first `### ` h3 below the version heading, or the first
 * non-empty paragraph line if no h3 exists. Inline markdown is flattened —
 * see {@link stripInlineMarkdown}.
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
      title = stripInlineMarkdown(next.replace(/^#{2,}\s*/, "")).trim();
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
// version in the repo's .claude-plugin/plugin.json (kept in lockstep with
// src/setup.ts's VERSION) but before the user re-runs setup.sh, installed <
// packaged — the install is stale. SessionStart computes
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

/** Read the repo's packaged version from <repoPath>/.claude-plugin/plugin.json.
 *  This mirrors src/setup.ts's VERSION constant — CI enforces the two are equal
 *  (tests/plugin-manifest.test.ts) — but reads a structured JSON manifest
 *  instead of regexing a TS source file, which was brittle to any reformatting
 *  of the `const VERSION` line. Returns null if the repo is gone or the manifest
 *  is missing/unparsable/lacks a string version. Never throws. */
export async function readPackagedVersion(repoPath: string | null): Promise<string | null> {
  if (!repoPath) return null;
  const manifestPath = join(repoPath, ".claude-plugin", "plugin.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as { version?: unknown };
    // Require a well-formed X.Y.Z — compareVersion/computeDrift assume it, and a
    // malformed value would otherwise drive a bogus drift verdict.
    return typeof parsed.version === "string" && /^\d+\.\d+\.\d+$/.test(parsed.version)
      ? parsed.version
      : null;
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
