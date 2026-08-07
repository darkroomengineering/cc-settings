// `SHORTCUT:` marker validator. The convention is defined in AGENTS.md
// (Laziness Ladder): a deliberate simplification carries a comment naming both
// its ceiling and the trigger that should make someone revisit it.
//
//   // SHORTCUT: single global lock, not per-key.
//   // ceiling: contention above ~50 rps
//   // upgrade: shard by key hash when p99 write latency climbs
//
// The upgrade trigger is the load-bearing part. A marker naming a ceiling but no
// trigger is how a deferral quietly becomes permanent — nobody knows what would
// make it worth fixing, so nobody ever does. That case is an error; a missing
// ceiling is only a warning, since the trigger alone still says when to look.
//
// Only source files are scanned. Markdown is skipped on purpose: AGENTS.md and
// skills/audit/SKILL.md document the convention with fenced examples, and those
// are prose, not debt.
//
// Imported by:
//   - src/scripts/lint-shortcuts.ts  — CLI (`bun run lint:shortcuts`)
//   - tests/lint-shortcuts.test.ts

import { type Dirent, existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { formatLintFindings, hasLintErrors, type LintSeverity } from "./lint-frontmatter.ts";

export type ShortcutSeverity = LintSeverity;

export interface ShortcutFinding {
  file: string;
  line: number;
  severity: ShortcutSeverity;
  rule: string;
  message: string;
}

/** One parsed marker, for `/audit debt`'s ledger. */
export interface ShortcutMarker {
  file: string;
  line: number;
  summary: string;
  ceiling: string | null;
  upgrade: string | null;
}

export interface ShortcutResult {
  findings: ShortcutFinding[];
  markers: ShortcutMarker[];
  fileCount: number;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "vendor",
  "target",
  "coverage",
  ".turbo",
]);

// Source extensions only — see the module note on why .md is absent.
const SOURCE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "rb",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "php",
  "sh",
  "bash",
  "zsh",
  "sql",
  "css",
  "scss",
  "glsl",
  "vert",
  "frag",
]);

// A marker only counts on its own comment line — the prefix must be the first
// thing on the line. Anchoring is what keeps this file's own regex literals out
// of the ledger: a pattern containing the marker text mid-expression has code
// before its comment prefix, so it never matches. It also rules out a trailing
// `code(); // SHORTCUT: …`, which is the right call anyway — a marker carries two
// follow-up lines, so it always wants a block of its own.
const MARKER = /^\s*(?:\/\/|\/\*|#|--|;|\*)\s*SHORTCUT:\s*(.*)$/;
const FIELD = /^\s*(?:\/\/|\/\*|#|--|;|\*)\s*(ceiling|upgrade)\s*:\s*(.+?)\s*$/i;

// How far past the marker to look for its ceiling/upgrade lines. Generous enough
// for a wrapped summary, tight enough that the next marker can't be absorbed.
const FIELD_LOOKAHEAD = 6;

/** Parse one file's text into markers. Exported for tests. */
export function parseShortcuts(file: string, text: string): ShortcutMarker[] {
  const lines = text.split(/\r?\n/);
  const markers: ShortcutMarker[] = [];

  for (let i = 0; i < lines.length; i++) {
    const hit = lines[i]?.match(MARKER);
    if (!hit) continue;

    const marker: ShortcutMarker = {
      file,
      line: i + 1,
      summary: (hit[1] ?? "").trim(),
      ceiling: null,
      upgrade: null,
    };

    const limit = Math.min(i + 1 + FIELD_LOOKAHEAD, lines.length);
    for (let j = i + 1; j < limit; j++) {
      const next = lines[j];
      if (next === undefined) break;
      // A second marker ends the first one's block.
      if (MARKER.test(next)) break;
      const field = next.match(FIELD);
      if (!field) continue;
      const key = field[1]?.toLowerCase();
      const value = field[2]?.trim() ?? "";
      if (key === "ceiling" && marker.ceiling === null) marker.ceiling = value;
      if (key === "upgrade" && marker.upgrade === null) marker.upgrade = value;
    }

    markers.push(marker);
  }

  return markers;
}

function check(marker: ShortcutMarker): ShortcutFinding[] {
  const findings: ShortcutFinding[] = [];
  const at = { file: marker.file, line: marker.line };

  if (marker.upgrade === null) {
    findings.push({
      ...at,
      severity: "error",
      rule: "no-upgrade-trigger",
      message:
        "SHORTCUT: marker has no `upgrade:` line — name what should trigger revisiting it, or drop the marker. Without a trigger the deferral silently becomes permanent.",
    });
  }
  if (marker.ceiling === null) {
    findings.push({
      ...at,
      severity: "warning",
      rule: "no-ceiling",
      message:
        "SHORTCUT: marker has no `ceiling:` line — name the limit this simplification accepts.",
    });
  }
  if (marker.summary === "") {
    findings.push({
      ...at,
      severity: "warning",
      rule: "no-summary",
      message:
        "SHORTCUT: marker has no summary — say what was simplified on the marker line itself.",
    });
  }

  return findings;
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return; // unreadable dir is not a lint failure
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = entry.name.split(".").pop()?.toLowerCase();
    if (ext === undefined || !SOURCE_EXTENSIONS.has(ext)) continue;
    out.push(full);
  }
}

/** Scan a directory tree for `SHORTCUT:` markers and validate each one. */
export async function lintShortcutsDir(root: string): Promise<ShortcutResult> {
  if (!existsSync(root)) return { findings: [], markers: [], fileCount: 0 };

  const paths: string[] = [];
  await walk(root, paths);

  const findings: ShortcutFinding[] = [];
  const markers: ShortcutMarker[] = [];
  let fileCount = 0;

  for (const path of paths.sort()) {
    fileCount++;
    const found = parseShortcuts(relative(root, path) || path, await readFile(path, "utf8"));
    markers.push(...found);
    for (const marker of found) findings.push(...check(marker));
  }

  return { findings, markers, fileCount };
}

export function formatFindings(result: ShortcutResult): string {
  return formatLintFindings(result.findings, result.fileCount, {
    noun: "source file",
    getItem: (f) => `${f.file}:${f.line}`,
  });
}

/** The `/audit debt` ledger view — every marker, no-trigger ones first. */
export function formatLedger(result: ShortcutResult): string {
  if (result.markers.length === 0) return "No SHORTCUT: debt. Clean ledger.";

  const ordered = [...result.markers].sort((a, b) => {
    const aOrphan = a.upgrade === null ? 0 : 1;
    const bOrphan = b.upgrade === null ? 0 : 1;
    if (aOrphan !== bOrphan) return aOrphan - bOrphan;
    return a.file.localeCompare(b.file) || a.line - b.line;
  });

  const rows = ordered.map((m) => {
    const head = `${m.file}:${m.line}  ${m.summary || "(no summary)"}`;
    const ceiling = `               ceiling: ${m.ceiling ?? "(none)"}`;
    const upgrade =
      m.upgrade === null ? "               [no-trigger]" : `               upgrade: ${m.upgrade}`;
    return `${head}\n${ceiling}\n${upgrade}`;
  });

  const orphans = result.markers.filter((m) => m.upgrade === null).length;
  return `${rows.join("\n\n")}\n\n${result.markers.length} markers, ${orphans} with no trigger.`;
}

export function hasErrors(result: ShortcutResult): boolean {
  return hasLintErrors(result.findings);
}
