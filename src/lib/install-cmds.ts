// Install command helpers — extracted from src/setup.ts (§1.1).
//
// One-shot commands that run before the main install logic:
//   printHelp — usage text
//   cmdRollback — restore a backup archive

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { error, info, success } from "./colors.ts";
import { MANAGED_TOP_LEVEL_PATHS, sharedDirOwnedFiles } from "./managed-paths.ts";
import { CLAUDE_DIR } from "./platform.ts";

export function printHelp(version: string): void {
  console.log(`cc-settings installer v${version}

Usage: bun src/setup.ts [flags]

Flags:
  --source=<dir>     Source repo path (default: parent of setup.ts).
  --rollback[=TS]    Restore newest backup, or one matching timestamp TS.
  --dry-run          Print planned actions; do not touch disk.
  --light            Install raw Claude Code + statusLine + share-learning only:
                       • skills: share-learning (only)
                       • settings.json: $schema + statusLine only
                       • no MCP servers, no hooks, no effort override
                       • no CLAUDE.md, AGENTS.md, agents, rules, profiles,
                         docs, or permission rules
                     Re-run without --light to upgrade to full.
  --status           Report installed version, drift vs repo HEAD, missing
                     managed skills, hooks, key env vars, MCP servers, and
                     (macOS) auto-update enrollment.
  --auto-update=on|off  Enable/disable the daily 10am auto-update job
                     (macOS only). Asked once on first interactive install
                     and remembered; this flag overrides the decision
                     anytime, interactively or not.
  --interactive      Prompt on settings.json conflicts (scalar overrides, team
                     additions to allow/ask rules, new hook groups). Also opt in
                     via CC_INTERACTIVE=1.
  --migrate-only     Run only the settings.json merger + version sentinel;
                     skip file copy, dependency install, and skill/agent
                     refresh. Use after a cc-settings update if you only
                     want the merger's deprecation prune to apply.
  --help, -h         Show this message.

Rollback examples:
  bun src/setup.ts --rollback
  bun src/setup.ts --rollback=2026-04-20T10-00-00Z`);
}

/** True when a `tar -tzf` listing entry is unsafe to extract: an absolute
 *  path, or a path containing a ".." segment (path traversal). Pure/exported
 *  for testing without spawning tar. */
export function isUnsafeTarEntry(entry: string): boolean {
  if (entry.startsWith("/")) return true;
  return entry.split("/").some((segment) => segment === "..");
}

/**
 * The distinct top-level managed paths (relative to the extract cwd) that an
 * archive will restore. Used to prune the current install to an EXACT restore:
 * `tar -xzf` overlays, so on its own it leaves files a newer release added that
 * the snapshot never had (e.g. a skill introduced after the backup). Pruning
 * these units first removes that drift.
 *
 * Granularity is one level below the extract root — `.claude/skills`, not
 * `.claude` — so regenerable/unmanaged siblings (backups/, tmp/, logs/, src/)
 * are never touched. Only paths the archive actually contains are returned, so
 * a restore can never delete something it won't put back. Pure/exported for
 * testing without spawning tar.
 */
/** Strip a leading `./` (some tar builds prepend it) and surrounding whitespace.
 *  Normalizing once, up front, keeps layout detection, the traversal guard, and
 *  the prune set all reading the same canonical entry form. */
function normalizeArchiveEntry(raw: string): string {
  let entry = raw.trim();
  while (entry.startsWith("./")) entry = entry.slice(2);
  return entry;
}

/** The set of restore units (relative to the extract cwd) that cc-settings
 *  actually manages: settings.json + every MANAGED_TOP_LEVEL_PATHS entry, plus
 *  the home-relative ~/.claude.json. Rollback prunes ONLY these — never a path
 *  an arbitrary archive happens to contain (e.g. `.claude/backups`, which would
 *  delete the backups dir, including the archive being restored). */
function managedRestoreAllowset(homeRelative: boolean): Set<string> {
  const rels = ["settings.json", ...MANAGED_TOP_LEVEL_PATHS.map((e) => e.rel)];
  const set = new Set<string>();
  if (homeRelative) {
    set.add(".claude.json");
    for (const r of rels) set.add(`.claude/${r}`);
  } else {
    // Legacy ~/.claude-relative archives never carry .claude.json.
    for (const r of rels) set.add(r);
  }
  return set;
}

export function restoreUnitsFromArchive(archiveEntries: string[], homeRelative: boolean): string[] {
  const units = new Set<string>();
  // A segment is safe to prune only if it names a real child — never "", ".",
  // or "..". A leading "./" or a bare "." entry (some tar builds emit them)
  // would otherwise collapse to the extract root and rm the ENTIRE tree
  // (~/.claude, backups and all). isUnsafeTarEntry rejects ".." but not ".".
  const cleanSeg = (seg: string | undefined): string | null =>
    seg && seg !== "." && seg !== ".." ? seg : null;
  for (const raw of archiveEntries) {
    const entry = normalizeArchiveEntry(raw);
    if (!entry || entry === ".") continue;
    if (homeRelative) {
      if (entry === ".claude.json") {
        units.add(".claude.json");
      } else if (entry.startsWith(".claude/")) {
        const seg = cleanSeg(entry.slice(".claude/".length).split("/")[0]);
        if (seg) units.add(`.claude/${seg}`);
      }
    } else {
      const seg = cleanSeg(entry.split("/")[0]);
      if (seg) units.add(seg);
    }
  }
  // Restrict to the managed allowlist: a rollback only ever deletes+restores
  // paths cc-settings owns, never whatever else an archive may contain.
  const allow = managedRestoreAllowset(homeRelative);
  return [...units].filter((u) => allow.has(u));
}

export async function cmdRollback(target: string | true): Promise<number> {
  const backupDir = `${CLAUDE_DIR}/backups`;
  if (!existsSync(backupDir)) {
    error(`No backups directory found at ${backupDir}`);
    return 1;
  }
  const entries = (await readdir(backupDir))
    .filter((e) => /^backup-.*\.tar\.gz$/.test(e))
    .sort()
    .reverse();
  const match = target === true ? entries[0] : entries.find((e) => e.includes(target));
  if (!match) {
    error("No matching backup found.");
    console.error("Available backups:");
    for (const e of entries.slice(0, 5)) console.error(`  ${e}`);
    return 1;
  }
  info(`Rolling back from: ${match}`);
  const archivePath = `${backupDir}/${match}`;
  // Newer archives are $HOME-relative (entries prefixed with ".claude/", plus a
  // top-level ".claude.json"); pre-MCP-backup archives are ~/.claude-relative
  // (bare "settings.json"). Detect the layout so each restores to the right place.
  const listing = Bun.spawn(["tar", "-tzf", archivePath], { stdout: "pipe", stderr: "ignore" });
  const rawEntries = (await new Response(listing.stdout).text()).trim().split("\n");
  const listingCode = await listing.exited;
  // A corrupt archive can emit a partial listing then a non-zero exit. Since the
  // listing drives the destructive swap below, refuse to proceed unless tar read
  // the whole archive cleanly.
  if (listingCode !== 0) {
    error(
      `Refusing to restore: could not read archive listing (tar -tzf exited ${listingCode}). ` +
        "The backup may be corrupt — pick another with --rollback=<timestamp>.",
    );
    return 1;
  }
  // Normalize entries ONCE (strip leading "./"), then run layout detection, the
  // traversal guard, and the prune-set derivation over the canonical form.
  const archiveEntries = rawEntries.map(normalizeArchiveEntry).filter((e) => e && e !== ".");
  const homeRelative = archiveEntries.some((e) => e.startsWith(".claude/") || e === ".claude.json");
  // Path-traversal guard: reject the archive if any entry would extract outside
  // the destination (absolute path, or a ".." segment escaping it).
  const unsafeEntry = archiveEntries.find(isUnsafeTarEntry);
  if (unsafeEntry) {
    error(`Refusing to restore: archive contains an unsafe path entry: ${unsafeEntry}`);
    return 1;
  }
  const extractCwd = homeRelative ? homedir() : CLAUDE_DIR;
  const pruneUnits = restoreUnitsFromArchive(archiveEntries, homeRelative);

  // Extract into a staging dir FIRST, then restore. Extracting before touching
  // anything live removes the wipe-on-failure hazard: a corrupt archive or full
  // disk fails here, with the install untouched. Staging lives under ~/.claude/
  // tmp so it's on the same filesystem as the destination.
  const staging = await mkdtemp(join(CLAUDE_DIR, "tmp", "rollback-"));
  try {
    const proc = Bun.spawn(["tar", "-xzf", archivePath], {
      cwd: staging,
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
      error(`Restore failed: tar -xzf exited ${code}. Your install is untouched.`);
      return code;
    }
    // Swap each managed unit the archive covers: remove the live copy, move the
    // staged copy into place. We touch ONLY units present in the archive — a
    // legacy/partial backup (e.g. just settings.json + CLAUDE.md) leaves the
    // rest of the install untouched rather than deleting content it can't
    // restore. Within a swapped unit this is a point-in-time restore: the whole
    // dir is replaced by its backed-up contents, so anything added to that unit
    // after the backup is not preserved — that's the defined meaning of "roll
    // back to this snapshot" (createBackup captured the unit whole, user files
    // included). rename is same-filesystem here, so it's effectively atomic and,
    // unlike a recursive copy, can't half-finish on ENOSPC.
    //
    // EXCEPTION: shared dirs (sharedDirOwnedFiles — currently just
    // output-styles/, which Claude Code's own /config picker invites users to
    // hand-write files into). A whole-unit prune+restore there would delete a
    // personal file written AFTER the backup was taken — the same data-loss
    // class narrowed on the install/downgrade paths, and rollback is the one
    // place that hadn't been narrowed yet. For those units, never delete the
    // live directory: restore ONLY the owned files over the top, leaving every
    // other file in it untouched.
    for (const unit of pruneUnits) {
      const staged = join(staging, unit);
      if (!existsSync(staged)) continue;
      const live = join(extractCwd, unit);
      const rel = homeRelative ? unit.replace(/^\.claude\//, "") : unit;
      const owned = sharedDirOwnedFiles(rel);
      if (owned) {
        await mkdir(live, { recursive: true });
        for (const file of owned) {
          const stagedFile = join(staged, file);
          if (!existsSync(stagedFile)) continue;
          await rm(join(live, file), { force: true });
          await rename(stagedFile, join(live, file));
        }
        continue;
      }
      await rm(live, { recursive: true, force: true });
      await rename(staged, live);
    }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
  success("Restored. Restart Claude Code to apply.");
  return 0;
}
