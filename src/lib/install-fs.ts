// Fs-mutation install phases — everything that actually touches disk during
// an install: backup, directory scaffolding, stale-config cleanup, and the
// copy phases (config files + the ~/.claude/src TS tree).
//
// These depend only on sourceDir/profile/CLAUDE_DIR-style inputs, never on
// Args, CLI dispatch, or settings-merge — src/setup.ts owns orchestration
// (phase order, dependency install, settings write) and calls into here for
// the disk work.

import { existsSync, statSync } from "node:fs";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { error } from "./colors.ts";
import {
  LIGHT_SKILLS,
  lightProfilePruneTargets,
  PROFILE_MANIFEST,
  type Profile,
} from "./light-profile.ts";
import { ACTIVE_SKILLS, MANAGED_SKILLS } from "./managed-skills.ts";
import { CLAUDE_DIR, getTimestamp } from "./platform.ts";

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
}

export const MANAGED_TOP_LEVEL_PATHS: ManagedTopLevelEntry[] = [
  { rel: "CLAUDE.md", wipe: "recursive" },
  { rel: "AGENTS.md", wipe: "recursive" },
  { rel: "agents", wipe: { glob: /\.md$/ } },
  { rel: "skills", wipe: { glob: /\.(json|md)$/ } },
  { rel: "rules", wipe: { glob: /\.md$/ } },
  { rel: "profiles", wipe: { glob: /\.md$/ } },
  { rel: "docs", wipe: { glob: /\.md$/ } },
  { rel: "hooks", wipe: { glob: /\.md$/ } },
  // Scoped to the ONE style we ship, unlike the `\.md$` wipes above. Users are
  // actively encouraged (by Claude Code's own /config picker) to hand-write
  // styles at this exact path, and a broad glob here would delete a personal
  // output style on every install — data loss, not a stale-file prune.
  { rel: "output-styles", wipe: { glob: /^darkroom\.md$/ } },
  // contexts/ retired (folded into profiles/); prune the legacy installed dir.
  { rel: "contexts", wipe: "recursive" },
  // Legacy bash-era dirs.
  { rel: "scripts", wipe: "recursive" },
  { rel: "lib", wipe: "recursive" },
  { rel: "hooks-config.json", wipe: "recursive" },
  { rel: "hooks-config.local.json", wipe: "recursive" },
];

// --- Install phases ------------------------------------------------------

/**
 * Fail-closed guard run BEFORE any destructive step (createBackup /
 * cleanOldConfig). Verifies sourceDir is a complete cc-settings checkout for
 * the target profile.
 *
 * Without this, a bad `--source` (a partial checkout, a wrong path, an
 * interrupted clone) is a data-loss bug: cleanOldConfig() rm -rf's the managed
 * footprint first, then the copy phase silently skips every missing source
 * (copyIfPresent returns false, copyDirContents no-ops on a missing srcDir),
 * leaving the user with a wiped install and nothing copied back. Aborting here
 * — while the existing install is still intact — is the only safe order.
 *
 * Throws listing every missing path; callers MUST NOT proceed past a throw.
 * composeSettings (config/ fragment validity) is validated separately by the
 * orchestrator, also pre-clean.
 */
export function preflightInstallSource(sourceDir: string, profile: Profile): void {
  if (!existsSync(sourceDir)) {
    throw new Error(`--source directory does not exist: ${sourceDir}`);
  }
  // Required source entries with their expected kind. Existence alone is not
  // enough: a required dir present as a regular file (or a file as a dir) would
  // pass an existsSync check, then fail the copy phase AFTER cleanOldConfig has
  // wiped the install. config/ (composeSettings) and src/ (TS runtime) are
  // needed by every profile — installTsSources silently no-ops on a missing
  // src/, so treat it as a hard requirement here.
  const required: Array<{ rel: string; kind: "dir" | "file" }> = [
    { rel: "config", kind: "dir" },
    { rel: "src", kind: "dir" },
    // A representative source file, so an empty/partial src/ (a broken checkout)
    // is caught here rather than after cleanOldConfig has wiped the install.
    { rel: join("src", "setup.ts"), kind: "file" },
  ];
  if (profile === "light") {
    // Light copies the LIGHT_SKILLS subset out of skills/.
    required.push({ rel: "skills", kind: "dir" });
  } else {
    const manifest = PROFILE_MANIFEST.full;
    for (const [src] of manifest.rootFiles) required.push({ rel: src, kind: "file" });
    for (const d of manifest.dirs) required.push({ rel: d, kind: "dir" });
  }
  // Verify the profile's actual skill set — not just that skills/ exists. A
  // partial checkout (skills/ present but individual skills missing) would
  // otherwise pass preflight, then cleanOldConfig wipes the installed skills and
  // the copy phase silently restores nothing. Gated on skills/ existing so a
  // wholly-missing dir stays a single clean problem, not one error per skill.
  if (existsSync(join(sourceDir, "skills"))) {
    const requiredSkills = profile === "light" ? LIGHT_SKILLS : ACTIVE_SKILLS;
    for (const name of requiredSkills) {
      required.push({ rel: join("skills", name, "SKILL.md"), kind: "file" });
    }
  }
  const problems: string[] = [];
  for (const { rel, kind } of required) {
    let ok = false;
    try {
      const st = statSync(join(sourceDir, rel));
      ok = kind === "dir" ? st.isDirectory() : st.isFile();
    } catch {
      ok = false; // missing
    }
    if (!ok) problems.push(`${rel} (${kind})`);
  }
  if (problems.length > 0) {
    throw new Error(
      `--source is not a complete cc-settings checkout (${sourceDir}). ` +
        `Missing or wrong type: ${problems.sort().join(", ")}. Refusing to install — the ` +
        "destructive clean phase would wipe your working install and then have nothing to copy.",
    );
  }
}

async function createBackup(): Promise<void> {
  const backupDir = join(CLAUDE_DIR, "backups");
  await mkdir(backupDir, { recursive: true });

  const home = homedir();
  // Home-relative paths so the archive can include ~/.claude.json — it holds the
  // MCP server config that installMcpToClaudeJson rewrites and lives alongside
  // ~/.claude, not inside it. Without it, --rollback could not restore a user's
  // MCP setup. cmdRollback detects this layout (".claude/"-prefixed entries) and
  // extracts from $HOME; older ~/.claude-relative archives still restore correctly.
  //
  // Every directory/file cleanOldConfig() unconditionally wipes on every run is
  // included here too — MANAGED_TOP_LEVEL_PATHS (agents/, skills/ including the
  // MANAGED_SKILLS dirs inside it, rules/, profiles/, docs/, hooks/, contexts/,
  // the legacy scripts/ and lib/ dirs, and hooks-config*.json). Without this, a
  // copy failure between cleanOldConfig and the copy phase leaves --rollback
  // able to restore only settings.json/CLAUDE.md/AGENTS.md/.claude.json — none
  // of the content actually wiped (H7). tar archives directories recursively,
  // so listing the directory itself is enough; existsSync below skips entries
  // that aren't present yet (e.g. a first-ever install). Deliberately excludes
  // backups/, tmp/, logs/, and tldr-cache — regenerable/non-managed, and
  // backups/ nesting itself would grow every archive by the sum of all prior
  // ones.
  const candidates = [
    ".claude/settings.json",
    ...MANAGED_TOP_LEVEL_PATHS.map((e) => `.claude/${e.rel}`),
    ".claude.json",
  ];
  const existing = candidates.filter((f) => existsSync(join(home, f)));
  if (existing.length === 0) return;

  const stamp = getTimestamp();
  const archive = join(backupDir, `backup-${stamp}.tar.gz`);
  const proc = Bun.spawn(["tar", "-czf", archive, ...existing], {
    cwd: home,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderrText, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) {
    // A silent backup failure would let the install proceed into cleanOldConfig
    // (which rm -rf's managed dirs) with no restore point — the advertised
    // --rollback safety net would be quietly disabled. Abort instead.
    error(`Backup failed (tar exited ${code}): ${stderrText.trim()}`);
    error("Aborting so --rollback stays possible. Fix the tar error above and re-run.");
    throw new Error(`backup failed — tar exited ${code}`);
  }

  // Keep last 5.
  const kept = (await readdir(backupDir)).filter((e) => /^backup-.*\.tar\.gz$/.test(e)).sort();
  if (kept.length > 5) {
    await Promise.all(
      kept
        .slice(0, kept.length - 5)
        .map((old) => rm(join(backupDir, old), { force: true }).catch(() => {})),
    );
  }
}

async function createDirectories(): Promise<void> {
  const dirs = [
    "agents",
    "skills",
    "profiles",
    "rules",
    "output-styles",
    "handoffs",
    "learnings",
    "hooks",
    "memory",
    "memory/agents",
    "docs",
    "tldr-cache",
    "backups",
    "tmp",
    "logs",
    "src",
    "src/scripts",
    "src/hooks",
    "src/lib",
    "src/schemas",
  ];
  await Promise.all(dirs.map((d) => mkdir(join(CLAUDE_DIR, d), { recursive: true })));
}

// Best-effort sweep of stale atomicWriteString/pointLatest staging files
// (`.<pid>-<epoch-ms>.tmp` / `.<linkName>.<pid>-<epoch-ms>.tmp`) that survive a
// hard kill between the staging write/symlink and the rename. Nothing else
// sweeps these, so they'd otherwise accumulate forever; only entries older
// than maxAgeMs are removed so an in-flight write from a concurrent process
// is never touched.
async function sweepStaleTmpFiles(dir: string, maxAgeMs: number): Promise<void> {
  if (!existsSync(dir)) return;
  const entries = await readdir(dir).catch(() => []);
  const now = Date.now();
  await Promise.all(
    entries
      .filter((e) => /^\..*\.tmp$/.test(e))
      .map(async (e) => {
        const full = join(dir, e);
        try {
          const st = await stat(full);
          if (now - st.mtimeMs > maxAgeMs) await rm(full, { force: true });
        } catch {
          // vanished between readdir and stat, or a permissions blip — ignore
        }
      }),
  );
}

async function cleanOldConfig(): Promise<void> {
  const removeGlob = async (dir: string, pattern: RegExp) => {
    const full = join(CLAUDE_DIR, dir);
    if (!existsSync(full)) return;
    const entries = await readdir(full).catch(() => []);
    await Promise.all(
      entries.filter((e) => pattern.test(e)).map((e) => rm(join(full, e), { force: true })),
    );
  };

  const junkFiles = [
    "skill-rules.cache",
    "skill-activation.out",
    "skill-index.compiled",
    "skill-index.checksum",
  ];

  const wipeTasks = MANAGED_TOP_LEVEL_PATHS.map((entry) =>
    entry.wipe === "recursive"
      ? rm(join(CLAUDE_DIR, entry.rel), { recursive: true, force: true }).catch(() => {})
      : removeGlob(entry.rel, entry.wipe.glob),
  );

  // Every removal below targets a disjoint path, so they run concurrently:
  // MANAGED_TOP_LEVEL_PATHS wipes (legacy bash artifacts, fresh wipes of
  // managed content re-installed after, glob-scoped prunes), managed skill
  // directories, and stale caches + legacy top-level docs.
  await Promise.all([
    ...wipeTasks,
    ...MANAGED_SKILLS.map((s) =>
      rm(join(CLAUDE_DIR, "skills", s), { recursive: true, force: true }),
    ),
    ...junkFiles.map((junk) => rm(join(CLAUDE_DIR, junk), { force: true }).catch(() => {})),
    // Stale atomic-write staging files older than 1 day — see sweepStaleTmpFiles.
    sweepStaleTmpFiles(CLAUDE_DIR, 24 * 60 * 60 * 1000),
  ]);
}

async function copyIfPresent(src: string, dst: string): Promise<boolean> {
  if (!existsSync(src)) return false;
  await cp(src, dst, { recursive: false, force: true });
  return true;
}

/**
 * Copy entries from srcDir to dstDir, filtering by the keep predicate.
 * Skips entries where keep(name) returns false.
 */
async function copyDirContentsFiltered(
  srcDir: string,
  dstDir: string,
  keep: (name: string) => boolean,
): Promise<void> {
  if (!existsSync(srcDir)) return;
  await mkdir(dstDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  // Each entry copies to a distinct destination path — run them concurrently.
  await Promise.all(
    entries
      .filter((e) => keep(e.name))
      .map((e) => cp(join(srcDir, e.name), join(dstDir, e.name), { recursive: true, force: true })),
  );
}

/** Copy all entries from srcDir to dstDir (no filtering). */
async function copyDirContents(srcDir: string, dstDir: string): Promise<void> {
  return copyDirContentsFiltered(srcDir, dstDir, () => true);
}

/**
 * Execute the copy/prune footprint for an install. cleanOldConfig must
 * already have run so MANAGED_SKILLS dirs are wiped before copy.
 *
 * For the light profile, the copy is the LIGHT_SKILLS subset (filtered copy)
 * and the prune list comes from lightProfilePruneTargets — light-profile.ts's
 * single source of truth for what the light path removes from a prior full
 * install (full-minus-light).
 */
async function installConfigFiles(source: string, profile: Profile): Promise<void> {
  if (profile === "light") {
    const lightSkillSet = new Set(LIGHT_SKILLS);
    await copyDirContentsFiltered(join(source, "skills"), join(CLAUDE_DIR, "skills"), (name) =>
      lightSkillSet.has(name),
    );
    // Execute the prune targets (skill dirs + full-only rootFiles/dirs).
    const pruneTargets = lightProfilePruneTargets();
    await Promise.all(
      pruneTargets.map((rel) =>
        rm(join(CLAUDE_DIR, rel), { recursive: true, force: true }).catch(() => {}),
      ),
    );
  } else {
    // Full profile: every rootFile + dir from the manifest. Destinations are
    // disjoint, so all copies run in parallel.
    const manifest = PROFILE_MANIFEST.full;
    await Promise.all([
      ...manifest.rootFiles.map(([src, dest]) =>
        copyIfPresent(join(source, src), join(CLAUDE_DIR, dest)),
      ),
      ...manifest.dirs.map((d) => copyDirContents(join(source, d), join(CLAUDE_DIR, d))),
    ]);
  }
}

async function installTsSources(source: string): Promise<void> {
  const srcTs = join(source, "src");
  if (!existsSync(srcTs)) return;
  const dstTs = join(CLAUDE_DIR, "src");
  // Clean previous TS install so stale ports don't linger.
  await rm(dstTs, { recursive: true, force: true });
  await mkdir(dstTs, { recursive: true });
  await copyDirContents(srcTs, dstTs);

  // Dep resolution: copy lockfile + config, link node_modules back to source.
  await Promise.all([
    copyIfPresent(join(source, "package.json"), join(dstTs, "package.json")),
    copyIfPresent(join(source, "tsconfig.json"), join(dstTs, "tsconfig.json")),
    copyIfPresent(join(source, "bun.lock"), join(dstTs, "bun.lock")),
  ]);

  const srcNm = join(source, "node_modules");
  const dstNm = join(dstTs, "node_modules");
  if (existsSync(srcNm) && !existsSync(dstNm)) {
    try {
      await Bun.spawn(["ln", "-s", srcNm, dstNm], { stdout: "ignore", stderr: "ignore" }).exited;
    } catch {
      await cp(srcNm, dstNm, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export { cleanOldConfig, createBackup, createDirectories, installConfigFiles, installTsSources };
