// Managed top-level paths — the single enumeration of "what cc-settings owns
// inside CLAUDE_DIR", plus the shared-directory carve-out.
//
// Lives in its own module rather than in install-fs.ts because THREE consumers
// need it and one of them is install-fs.ts's own dependency:
//   - install-fs.ts   createBackup (tars each entry whole) + cleanOldConfig
//   - install-cmds.ts --rollback restore
//   - light-profile.ts full→light prune
// light-profile.ts is imported BY install-fs.ts, so having it import back for
// sharedDirOwnedFiles created an import cycle. The data has no dependencies of
// its own, so extracting it breaks the cycle structurally instead of relying on
// hoisting to make the cycle resolve.

// ---------------------------------------------------------------------------
// Managed top-level paths — shared by createBackup + cleanOldConfig
// ---------------------------------------------------------------------------
//
// Both phases enumerate "what cc-settings manages" at the top level of
// CLAUDE_DIR. Two independently hand-maintained lists previously drifted
// apart — a divergence that caused incident H7 (a copy failure between
// cleanOldConfig and the copy phase left --rollback unable to restore
// anything cleanOldConfig had actually wiped, because createBackup's list
// was narrower). One list now backs both: createBackup tars every entry
// whole; cleanOldConfig applies its own per-entry granularity ("recursive"
// removes the whole dir/file, "glob" removes only matching entries inside a
// dir so user-authored siblings survive).
//
// NOT covered here (each intentionally out of scope for this shared list):
//   - settings.json    — merged in place by installSettings, never wiped;
//                         createBackup still backs it up separately.
//   - .claude.json      — lives outside CLAUDE_DIR entirely (home-relative);
//                         createBackup still backs it up separately.
//   - regenerable caches (skill-rules.cache, tldr-cache, backups/, tmp/,
//     logs/) — never backed up, cleaned via cleanOldConfig's own junkFiles
//     list + sweepStaleTmpFiles.

type WipeMode = "recursive" | { glob: RegExp };

interface ManagedTopLevelEntry {
  /** Path relative to CLAUDE_DIR (and to the home-relative ".claude/" prefix
   *  createBackup's tar candidates use). */
  rel: string;
  /** How cleanOldConfig wipes it. */
  wipe: WipeMode;
  /**
   * When set, cc-settings owns ONLY these filenames inside this directory —
   * every other file inside it belongs to the user and must NEVER be deleted
   * by an install, a full→light downgrade, or `--rollback`. This is for
   * directories Claude Code's own tooling invites users to hand-write files
   * into directly (output-styles/, via the /config picker) — a namespace
   * cc-settings SHARES with the user rather than owns outright, unlike every
   * other entry in this list. Getting this wrong is data loss, not a
   * stale-file prune: see tests/output-style-preserve.test.ts.
   *
   * Single source of truth for "which files do we actually own here" —
   * consumed via `sharedDirOwnedFiles()` below by light-profile.ts's
   * full→light prune AND install-cmds.ts's `--rollback` restore, so the fact
   * can't drift between the three call sites that each separately need it.
   */
  ownedFiles?: readonly string[];
}

/** Escape a literal filename for exact-match embedding in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a WipeMode that matches exactly the given filenames. Used for shared
 *  dirs so `ownedFiles` and cleanOldConfig's wipe glob are derived from the
 *  SAME array and can never drift apart from each other. */
function ownedFilesWipe(files: readonly string[]): WipeMode {
  return { glob: new RegExp(`^(${files.map(escapeRegExp).join("|")})$`) };
}

// Scoped to the ONE style we ship, unlike the `\.md$` wipes below. Users are
// actively encouraged (by Claude Code's own /config picker) to hand-write
// styles at this exact path, and a broad glob here would delete a personal
// output style on every install — data loss, not a stale-file prune.
const OUTPUT_STYLES_OWNED_FILES = ["darkroom.md"] as const;

export const MANAGED_TOP_LEVEL_PATHS: ManagedTopLevelEntry[] = [
  { rel: "CLAUDE.md", wipe: "recursive" },
  { rel: "AGENTS.md", wipe: "recursive" },
  { rel: "agents", wipe: { glob: /\.md$/ } },
  { rel: "skills", wipe: { glob: /\.(json|md)$/ } },
  { rel: "rules", wipe: { glob: /\.md$/ } },
  { rel: "profiles", wipe: { glob: /\.md$/ } },
  { rel: "docs", wipe: { glob: /\.md$/ } },
  { rel: "hooks", wipe: { glob: /\.md$/ } },
  {
    rel: "output-styles",
    ownedFiles: OUTPUT_STYLES_OWNED_FILES,
    wipe: ownedFilesWipe(OUTPUT_STYLES_OWNED_FILES),
  },
  // contexts/ retired (folded into profiles/); prune the legacy installed dir.
  { rel: "contexts", wipe: "recursive" },
  // Legacy bash-era dirs.
  { rel: "scripts", wipe: "recursive" },
  { rel: "lib", wipe: "recursive" },
  { rel: "hooks-config.json", wipe: "recursive" },
  { rel: "hooks-config.local.json", wipe: "recursive" },
];

/**
 * The filenames cc-settings owns inside `rel` (relative to CLAUDE_DIR) — or
 * undefined when `rel` isn't a shared dir (either it's not a managed
 * top-level path at all, or it's one cc-settings owns outright). Single
 * source of truth read by light-profile.ts (full→light prune) and
 * install-cmds.ts (`--rollback` restore) — see `ownedFiles` on
 * `ManagedTopLevelEntry` for why this must not be duplicated per call site.
 */
export function sharedDirOwnedFiles(rel: string): readonly string[] | undefined {
  return MANAGED_TOP_LEVEL_PATHS.find((e) => e.rel === rel)?.ownedFiles;
}
