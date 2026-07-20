// Shared mechanics for the timestamped-artifact CLIs (checkpoint.ts,
// handoff.ts). Both stores keep a flat directory of timestamp-named files plus
// a "latest" symlink, and both grew the same four mechanics independently:
// timestamp-id generation, the unlink-then-symlink "latest" dance,
// list-with-latest-marker, and resolve-by-id-or-latest.
//
// On-disk formats, directory layouts, and CLI surfaces stay in the scripts —
// this module is mechanics only. Helpers fail soft where the originals did
// (missing dirs list as empty, missing links read as "").

import { existsSync } from "node:fs";
import { readdir, readlink, rename, rm, stat, symlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { pad } from "./platform.ts";

/**
 * Timestamp-derived artifact id: `<prefix>YYYYMMDD<sep>HHMMSS`.
 *
 *   checkpoint: timestampId("chk-", "-") → "chk-20260609-142233"
 *   handoff:    timestampId("", "_")     → "20260609_142233"
 */
export function timestampId(prefix: string, sep: string, d: Date = new Date()): string {
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${prefix}${date}${sep}${time}`;
}

/**
 * Point `<dir>/<linkName>` at `targetFile` (a relative symlink to its
 * basename). Atomic: builds the new symlink at a temp name in the same dir,
 * then renames it over `linkName` — a POSIX rename() is an atomic replace, so
 * a concurrent reader never observes a transient "no latest" state (the old
 * unlink-then-symlink dance had exactly that gap).
 */
export async function pointLatest(
  dir: string,
  targetFile: string,
  linkName: string,
): Promise<void> {
  const link = join(dir, linkName);
  const tmpLink = join(dir, `.${linkName}.${process.pid}-${Date.now()}.tmp`);
  try {
    await symlink(basename(targetFile), tmpLink);
    await rename(tmpLink, link);
  } catch (err) {
    await rm(tmpLink, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Artifact filenames in `dir` matching `pattern`, sorted ascending.
 * Missing or unreadable dir ⇒ [].
 */
export async function listArtifacts(dir: string, pattern: RegExp): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => pattern.test(name)).sort();
  } catch {
    return [];
  }
}

/**
 * The filename the latest-symlink points to, or "" when the link is absent.
 * Used by list commands to render the "(latest)" marker.
 */
export async function readLatestTarget(dir: string, linkName: string): Promise<string> {
  try {
    return await readlink(join(dir, linkName));
  } catch {
    return "";
  }
}

/**
 * List artifacts in `dir` matching `pattern` (RegExp against the filename, or
 * a predicate), sort newest-first by mtime, and return the ABSOLUTE paths of
 * everything beyond the newest `keep` — the prune candidates. Does NOT
 * delete; callers unlink (and any sibling files, e.g. checkpoint.ts's
 * `.patch` companion) themselves. A per-entry stat failure (the file vanished
 * between readdir and stat — a concurrent clean/save race) skips just that
 * one entry, never discards the whole already-enumerated listing. Missing or
 * unreadable dir ⇒ [].
 */
export async function pruneArtifacts(
  dir: string,
  pattern: RegExp | ((name: string) => boolean),
  keep: number,
): Promise<string[]> {
  const matches = typeof pattern === "function" ? pattern : (name: string) => pattern.test(name);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const entries: Array<{ file: string; mtime: number }> = [];
  for (const name of names) {
    if (!matches(name)) continue;
    const full = join(dir, name);
    try {
      const st = await stat(full);
      entries.push({ file: full, mtime: st.mtimeMs });
    } catch {
      // vanished between readdir and stat — skip just this entry
    }
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  return entries.slice(keep).map((e) => e.file);
}

export interface ResolveSpec {
  /** Symlink filename pointing at the latest artifact, e.g. "latest" or "latest.md". */
  latestLink: string;
  /** Map a user-supplied id to the artifact filename, e.g. id ⇒ `${id}.json`. */
  idToName: (id: string) => string;
}

/**
 * Resolve a user-supplied id — or "" meaning "latest" — to an absolute
 * artifact path. Returns null when the artifact (or the latest-link target)
 * is missing.
 */
export async function resolveArtifact(
  dir: string,
  idOrLatest: string,
  spec: ResolveSpec,
): Promise<string | null> {
  if (!idOrLatest) {
    try {
      const target = await readlink(join(dir, spec.latestLink));
      const full = join(dir, target);
      return existsSync(full) ? full : null;
    } catch {
      return null;
    }
  }
  const full = join(dir, spec.idToName(idOrLatest));
  return existsSync(full) ? full : null;
}
