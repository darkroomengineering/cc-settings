import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, rename, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Canonical list of cc-settings-managed skill directories.
//
// "Managed" means: the installer is allowed to wipe and re-write these on every
// install. Hand-authored skills outside this list are preserved.
//
// The list is split into two sections:
//   1. Currently shipped skills — present in skills/<name>/SKILL.md, installed
//      to ~/.claude/skills/<name>/
//   2. Upgrade-cleanup tombstones — names of skills that were removed in prior
//      releases. Kept here so re-install on an older user prunes the obsolete
//      directories from ~/.claude/skills/. Do not remove tombstones; they are
//      load-bearing for upgrades. When promoting a tombstone (renaming back
//      into active use is rare), move it to the active section.
//
// Imported by:
//   - src/setup.ts            — to know what to wipe + reinstall
//   - src/lib/status.ts       — to compute present/missing for `cc status`
//   - src/lib/lint-skills.ts  — to assert ACTIVE_SKILLS matches skills/ on disk
//
// Previously duplicated across both files; the duplication caused real drift
// risk (every new skill required edits in two places).
//
// INVARIANT: ACTIVE_SKILLS must list exactly the directories under skills/.
// lint-skills enforces this — a skill added to skills/ without an ACTIVE_SKILLS
// entry fails `bun run lint:skills`. (This replaces the old installer-side prune
// loop that re-read skills/ directly to cover the gap; the gap is now a lint
// error instead of silent install drift.)

/** Currently shipped skills — present in skills/<name>/SKILL.md, installed to
 *  ~/.claude/skills/<name>/. Keep in sync with the skills/ directory. */
export const ACTIVE_SKILLS = [
  "adhd",
  "audit",
  "autoresearch",
  "build",
  "cc",
  "checkpoint",
  "codex",
  "component",
  "consolidate",
  "context-doc",
  "design-tokens",
  "dr-init",
  "explore",
  "fix",
  "freeze",
  "handoff",
  "harvest",
  "hook",
  "lighthouse",
  "oracle",
  "orchestrate",
  "plan-ceo-review",
  "plan-feature",
  "project",
  "proof-of-work",
  "qa",
  "refactor",
  "retro",
  "review",
  "review-batch",
  "share-learning",
  "ship",
  "strategist",
  "test",
  "tldr",
  "triage",
  "verify",
  "zero-tech-debt",
];

/** Upgrade-cleanup tombstones — skills removed in prior releases. Kept so a
 *  re-install on an older user prunes the obsolete directories. Do not remove;
 *  they are load-bearing for upgrades. When reviving one, move it to
 *  ACTIVE_SKILLS and recreate its skills/<name>/ directory. */
export const TOMBSTONE_SKILLS = [
  "adversarial-audit",
  "ask",
  "cc-sync",
  "cc-update",
  "compare-approaches",
  "context",
  "create-handoff",
  "darkroom-init",
  "debug",
  "discovery",
  "docs",
  "f-thread",
  "figma",
  "init",
  "l-thread",
  "learn",
  "lenis",
  "long-task",
  "nuclear-review",
  "prd",
  "premortem",
  "resume-handoff",
  "tdd",
  "teams",
  "versions",
  "write-a-skill",
  "zoom-out",
];

/** Everything the installer may wipe + reinstall: active skills plus tombstones
 *  to prune. Consumers that only care about the wipe set use this. */
export const MANAGED_SKILLS = [...ACTIVE_SKILLS, ...TOMBSTONE_SKILLS];

export interface LegacyCodexSkillScan {
  root: string;
  overlapNames: string[];
  movableNames: string[];
  blockedNames: string[];
}

export interface LegacyCodexSkillMigration {
  scan: LegacyCodexSkillScan;
  backupDir: string | null;
  movedNames: string[];
  applied: boolean;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** Find user-scope skills created by an older Codex /import that duplicate
 * the skills supplied by darkroom@cc-settings. Never follows symlinks. */
export async function scanLegacyCodexSkills(home = homedir()): Promise<LegacyCodexSkillScan> {
  const agentsRoot = join(resolve(home), ".agents");
  const root = join(agentsRoot, "skills");
  const agentsMetadata = await lstat(agentsRoot).catch((error: unknown) => {
    if (missing(error)) return null;
    throw error;
  });
  if (!agentsMetadata) return { root, overlapNames: [], movableNames: [], blockedNames: [] };
  if (!agentsMetadata.isDirectory() || agentsMetadata.isSymbolicLink()) {
    throw new Error(`Refusing unsafe legacy skills parent: ${agentsRoot}`);
  }
  const rootMetadata = await lstat(root).catch((error: unknown) => {
    if (missing(error)) return null;
    throw error;
  });
  if (!rootMetadata) return { root, overlapNames: [], movableNames: [], blockedNames: [] };
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`Refusing unsafe legacy skills root: ${root}`);
  }

  const active = new Set(ACTIVE_SKILLS);
  const overlapNames: string[] = [];
  const movableNames: string[] = [];
  const blockedNames: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!active.has(entry.name)) continue;
    overlapNames.push(entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) movableNames.push(entry.name);
    else blockedNames.push(entry.name);
  }
  return {
    root,
    overlapNames: overlapNames.sort(),
    movableNames: movableNames.sort(),
    blockedNames: blockedNames.sort(),
  };
}

function migrationTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(".", "-");
}

export function formatLegacyCodexSkillOverlap(scan: LegacyCodexSkillScan): string | null {
  if (scan.overlapNames.length === 0) return null;
  const names = scan.overlapNames.slice(0, 8).join(", ");
  const rest = scan.overlapNames.length > 8 ? `, +${scan.overlapNames.length - 8} more` : "";
  return (
    `WARNING: ${scan.overlapNames.length} legacy ${scan.root} entries duplicate ` +
    `darkroom@cc-settings (${names}${rest}). Codex may shorten skill descriptions. ` +
    "Preview the safe move with `bun run migrate:codex-skills`; apply it with " +
    "`bun run migrate:codex-skills --apply`."
  );
}

/** Move only overlapping real directories to a timestamped sibling backup.
 * Dry-run is the default. A failed move rolls earlier moves back. */
export async function migrateLegacyCodexSkills(
  options: { home?: string; apply?: boolean; now?: Date } = {},
): Promise<LegacyCodexSkillMigration> {
  const scan = await scanLegacyCodexSkills(options.home);
  if (scan.overlapNames.length === 0) {
    return { scan, backupDir: null, movedNames: [], applied: false };
  }
  const backupDir = join(
    resolve(options.home ?? homedir()),
    ".agents",
    `skills-backup-cc-settings-${migrationTimestamp(options.now ?? new Date())}`,
  );
  if (!options.apply) {
    return { scan, backupDir, movedNames: [], applied: false };
  }
  if (scan.blockedNames.length > 0) {
    throw new Error(
      `Refusing to move non-directory or symlinked legacy skill entries: ${scan.blockedNames.join(", ")}`,
    );
  }
  if (existsSync(backupDir)) throw new Error(`Backup destination already exists: ${backupDir}`);

  // Revalidate every boundary immediately before the first rename. Detection
  // may have raced another process, and a replaced path must fail closed.
  const rootMetadata = await lstat(scan.root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`Refusing unsafe legacy skills root: ${scan.root}`);
  }
  for (const name of scan.movableNames) {
    const metadata = await lstat(join(scan.root, name));
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`Legacy skill changed during migration: ${name}`);
    }
  }

  await mkdir(backupDir);
  const movedNames: string[] = [];
  try {
    for (const name of scan.movableNames) {
      await rename(join(scan.root, name), join(backupDir, name));
      movedNames.push(name);
    }
  } catch (error) {
    const restoreErrors: Array<{ name: string; error: unknown }> = [];
    for (const name of movedNames.reverse()) {
      try {
        await rename(join(backupDir, name), join(scan.root, name));
      } catch (restoreError) {
        restoreErrors.push({ name, error: restoreError });
      }
    }
    if (restoreErrors.length > 0) {
      throw new AggregateError(
        [error, ...restoreErrors.map(({ error: restoreError }) => restoreError)],
        `Legacy skill migration failed and rollback was incomplete for ${restoreErrors
          .map(({ name }) => name)
          .join(", ")}; preserve and inspect ${backupDir}`,
      );
    }
    await rmdir(backupDir).catch(() => {});
    throw error;
  }
  return { scan, backupDir, movedNames, applied: true };
}
