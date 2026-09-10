import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  archiveContainsUnit,
  assertContained,
  assertCurrentClaudeOwnershipMatches,
  assertManagedAbsentArchiveEmpty,
  assertSafeStagedPath,
  type CurrentClaudeOwnershipSnapshot,
  captureCurrentClaudeOwnership,
  isUnsafeTarEntry,
  managedRestoreAllowset,
  normalizeArchiveEntry,
  parseClaudeBackupState,
  restoreUnitsFromArchive,
  type StagedClaudeOwnership,
  validateStagedRestore,
} from "./claude-rollback-validation.ts";
import { error, info, success } from "./colors.ts";
import {
  type ClaudeBackupSnapshot,
  claudeBackupScheduleSidecar,
  claudeBackupStateSidecar,
} from "./install-fs.ts";
import { BACKUP_ONLY_PATHS, sharedDirOwnedFiles } from "./managed-paths.ts";
import { CLAUDE_DIR } from "./platform.ts";
import {
  parseAutoUpdateState,
  restoreAutoUpdateState,
  validateAutoUpdateStateSnapshot,
} from "./schedule.ts";

export { isUnsafeTarEntry, restoreUnitsFromArchive } from "./claude-rollback-validation.ts";
export function printHelp(version: string): void {
  console.log(`cc-settings installer v${version}

Usage: bash setup.sh [flags]
       pwsh -File setup.ps1 [flags]
       bun src/setup.ts [flags]  (advanced/direct invocation)

Flags:
  --target=auto|claude|codex|both
                     Install target. Auto selects both when Codex is on PATH,
                     otherwise Claude only.
  --source=<dir>     Source repo path (default: parent of setup.ts).
  --rollback[=TS]    Restore newest backup, or one matching timestamp TS.
  --uninstall        Remove cc-settings-managed files for the selected target.
  --dry-run          Print planned actions; do not touch disk.
  --light            Install the minimal profile for each selected product:
                       • Claude: statusLine + share-learning only
                       • Codex: managed AGENTS instructions + runtime source
                       • no Codex plugin, native role agents, or command rule
                     Re-run without --light to upgrade to full.
  --fresh            Reinstall as if from scratch: removes settings.json,
                     prior-install state, and the repo's local approvals
                     (.claude/settings.local.json), then installs the full
                     baseline. Login, history, and memory untouched. Recover
                     via --rollback.
  --status           Report install health for the selected target(s).
  --auto-update=on|off  Enable/disable the daily 10am auto-update job
                     (macOS only). Asked once on first interactive install
                     and remembered; this flag overrides the decision
                     anytime, interactively or not.
  --interactive      Prompt on settings.json conflicts (scalar overrides, team
                     additions to allow/ask rules, new hook groups). Also opt in
                     via CC_INTERACTIVE=1.
  --migrate-only     Claude-only settings.json merger + version sentinel.
                     target=codex rejects this flag; target=both runs the
                     Claude migration and skips Codex.
  --help, -h         Show this message.

Rollback examples:
  bash setup.sh --rollback
  bash setup.sh --rollback=2026-04-20T10-00-00Z
  pwsh -File setup.ps1 --rollback`);
}

export interface PreparedClaudeRollback {
  selectedArchiveName?: string;
  targetManagedPaths?: string[];
  execute(): Promise<number>;
  cleanup(): Promise<void>;
}

export class ClaudePrewriteOwnershipChangedError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

interface PrepareClaudeRollbackOptions {
  prepareManagedAbsent?: () => Promise<PreparedClaudeRollback>;
  schedulerPhase?: {
    before: () => Promise<void>;
    after: () => Promise<void>;
  };
}

interface PrepareClaudeCompensationOptions {
  afterManagedRemoval?: () => void | Promise<void>;
}

class StagedClaudeBackupChangedError extends Error {
  constructor(cause: unknown) {
    super("Prepared Claude backup changed before execution", { cause });
  }
}

const CLAUDE_SHARED_BACKUP_NAME = /^backup-(\d{14}-\d{3}-\d+-\d+)\.tar\.gz$/;

/** List complete shared-operation Claude backups without selecting or mutating one. */
export async function listClaudeSharedBackupIds(): Promise<string[]> {
  const backupDir = join(CLAUDE_DIR, "backups");
  const backupDirMetadata = await lstat(backupDir).catch(() => null);
  if (!backupDirMetadata) return [];
  if (!backupDirMetadata.isDirectory() || backupDirMetadata.isSymbolicLink()) {
    throw new Error(`Unsafe Claude backups directory: ${backupDir}`);
  }

  const ids: string[] = [];
  let firstInvalid: unknown = null;
  for (const entry of await readdir(backupDir, { withFileTypes: true })) {
    const match = CLAUDE_SHARED_BACKUP_NAME.exec(entry.name);
    if (!match || !entry.isFile()) continue;
    const archivePath = join(backupDir, entry.name);
    const archiveMetadata = await lstat(archivePath).catch(() => null);
    const sidecarPath = claudeBackupScheduleSidecar(archivePath);
    const sidecarMetadata = await lstat(sidecarPath).catch(() => null);
    const stateSidecarPath = claudeBackupStateSidecar(archivePath);
    const stateSidecarMetadata = await lstat(stateSidecarPath).catch(() => null);
    if (
      !archiveMetadata?.isFile() ||
      archiveMetadata.isSymbolicLink() ||
      !sidecarMetadata?.isFile() ||
      sidecarMetadata.isSymbolicLink() ||
      !stateSidecarMetadata?.isFile() ||
      stateSidecarMetadata.isSymbolicLink()
    ) {
      continue;
    }
    try {
      await validateAutoUpdateStateSnapshot(
        parseAutoUpdateState(await readFile(sidecarPath, "utf8")),
      );
      parseClaudeBackupState(await readFile(stateSidecarPath, "utf8"), archivePath);
      ids.push(match[1] as string);
    } catch (cause) {
      // Invalid scheduler metadata cannot form an exact cross-product restore point.
      firstInvalid ??= cause;
    }
  }
  if (ids.length === 0 && firstInvalid) throw firstInvalid;
  return ids.sort().reverse();
}

interface PrepareArchiveOptions {
  requireOwnershipState: boolean;
  exactSnapshot?: ClaudeBackupSnapshot;
  announce: boolean;
  currentOwnership?: CurrentClaudeOwnershipSnapshot;
  managedScope?: readonly string[];
  afterManagedRemoval?: () => void | Promise<void>;
}

async function prepareClaudeArchive(
  archivePath: string | null,
  options: PrepareArchiveOptions,
): Promise<PreparedClaudeRollback | number> {
  const rawEntries: string[] = [];
  if (archivePath) {
    const listing = Bun.spawn(["tar", "-tzf", archivePath], { stdout: "pipe", stderr: "ignore" });
    rawEntries.push(...(await new Response(listing.stdout).text()).trim().split("\n"));
    const listingCode = await listing.exited;
    if (listingCode !== 0) {
      error(
        `Refusing to restore: could not read archive listing (tar -tzf exited ${listingCode}). ` +
          "The backup may be corrupt — pick another with --rollback=<timestamp>.",
      );
      return 1;
    }
  }
  const archiveEntries = rawEntries
    .map(normalizeArchiveEntry)
    .filter((entry) => entry && entry !== ".");
  const unsafeEntry = archiveEntries.find(isUnsafeTarEntry);
  if (unsafeEntry) {
    error(`Refusing to restore: archive contains an unsafe path entry: ${unsafeEntry}`);
    return 1;
  }
  const homeRelative = options.exactSnapshot
    ? true
    : archiveEntries.some((entry) => entry.startsWith(".claude/") || entry === ".claude.json");
  if (options.requireOwnershipState && !options.exactSnapshot) {
    const prefix = homeRelative ? ".claude/" : "";
    const hasCompleteOwnershipState = BACKUP_ONLY_PATHS.every((rel) =>
      archiveContainsUnit(archiveEntries, `${prefix}${rel}`),
    );
    if (!hasCompleteOwnershipState) {
      error(
        "Refusing to restore this legacy or partial backup because it lacks complete Claude ownership metadata. " +
          "The live install was not changed.",
      );
      return 1;
    }
  }

  const extractCwd = homeRelative ? homedir() : CLAUDE_DIR;
  const archiveUnits = restoreUnitsFromArchive(archiveEntries, homeRelative);
  const restoreUnits = options.exactSnapshot ? [...managedRestoreAllowset(true)] : archiveUnits;
  await mkdir(join(CLAUDE_DIR, "tmp"), { recursive: true });
  const staging = await mkdtemp(join(CLAUDE_DIR, "tmp", "rollback-"));
  let validationUnits = archiveUnits;
  const validatePreparedStage = async (): Promise<StagedClaudeOwnership | null> => {
    if (options.exactSnapshot) {
      for (const ownedFile of options.exactSnapshot.sharedOwnedFilesPresent) {
        const stagedOwnedFile = join(staging, ownedFile);
        assertContained(staging, stagedOwnedFile);
        await assertSafeStagedPath(staging, ownedFile);
        const metadata = await lstat(stagedOwnedFile);
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
          throw new Error(`Invalid Claude shared owned file in backup: ${ownedFile}`);
        }
      }
    }
    return await validateStagedRestore(
      staging,
      validationUnits,
      homeRelative,
      options.requireOwnershipState,
      options.exactSnapshot?.managedFilesManifestVersion,
      options.exactSnapshot?.nodeModulesTarget,
      options.exactSnapshot?.managedFiles,
    );
  };
  let initialTargetOwnership: StagedClaudeOwnership | null = null;
  try {
    if (archivePath) {
      const proc = Bun.spawn(["tar", "-xzf", archivePath], {
        cwd: staging,
        stdout: "inherit",
        stderr: "inherit",
      });
      const code = await proc.exited;
      if (code !== 0) {
        error(`Restore failed: tar -xzf exited ${code}. Your install is untouched.`);
        await rm(staging, { recursive: true, force: true }).catch(() => {});
        return code;
      }
    }
    if (options.exactSnapshot) {
      const declared = new Set(options.exactSnapshot.present);
      const staged = new Set(archiveUnits);
      if (
        [...declared].some((unit) => !staged.has(unit)) ||
        [...staged].some((unit) => !declared.has(unit))
      ) {
        throw new Error("Claude backup archive does not match its exact ownership-state metadata");
      }
      validationUnits = options.exactSnapshot.present;
    }
    initialTargetOwnership = await validatePreparedStage();
    if (options.currentOwnership) {
      await assertCurrentClaudeOwnershipMatches(
        options.currentOwnership,
        initialTargetOwnership?.managedFiles,
      );
    }
  } catch (cause) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    const detail = cause instanceof Error && cause.message ? cause.message : String(cause);
    throw new Error(`Claude backup validation failed: ${detail}`, { cause });
  }

  let execution: Promise<number> | null = null;
  const pruneEmptyParents = async (path: string): Promise<void> => {
    let directory = dirname(path);
    while (directory !== CLAUDE_DIR) {
      try {
        await rmdir(directory);
      } catch (cause) {
        const code = (cause as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          directory = dirname(directory);
          continue;
        }
        if (code === "ENOTEMPTY") return;
        throw cause;
      }
      directory = dirname(directory);
    }
  };
  const executeOwnershipScopedRestore = async (
    currentManagedPaths: readonly string[],
    removeCurrentNodeModules: boolean,
    target: StagedClaudeOwnership | null,
  ): Promise<void> => {
    for (const relativePath of currentManagedPaths) {
      if (relativePath === "src/node_modules") continue;
      const live = join(CLAUDE_DIR, relativePath);
      await rm(live, { recursive: true, force: true });
      await pruneEmptyParents(live);
    }
    const liveNodeModules = join(CLAUDE_DIR, "src", "node_modules");
    if (removeCurrentNodeModules) {
      await rm(liveNodeModules, { recursive: true, force: true });
      await pruneEmptyParents(liveNodeModules);
    }
    await options.afterManagedRemoval?.();
    for (const relativePath of Object.keys(target?.managedFiles ?? {})) {
      const staged = join(staging, ".claude", relativePath);
      const live = join(CLAUDE_DIR, relativePath);
      const parent = dirname(live);
      const parentMetadata = await lstat(parent).catch(() => null);
      if (parentMetadata && !parentMetadata.isDirectory()) {
        await rm(parent, { recursive: true, force: true });
      }
      await mkdir(parent, { recursive: true });
      await rename(staged, live);
    }
    if (target?.nodeModulesTarget !== null && target?.nodeModulesTarget !== undefined) {
      const staged = join(staging, ".claude", "src", "node_modules");
      const stagedMetadata = await lstat(staged).catch(() => null);
      if (stagedMetadata) {
        const parent = dirname(liveNodeModules);
        const parentMetadata = await lstat(parent).catch(() => null);
        if (parentMetadata && !parentMetadata.isDirectory()) {
          await rm(parent, { recursive: true, force: true });
        }
        await mkdir(parent, { recursive: true });
        await rename(staged, liveNodeModules);
      }
    }
    const restoreExplicitFile = async (unit: string, live: string): Promise<void> => {
      const wasPresent = options.exactSnapshot?.present.includes(unit) ?? false;
      await rm(live, { recursive: true, force: true });
      if (!wasPresent) return;
      const staged = join(staging, unit);
      const metadata = await lstat(staged).catch(() => null);
      if (!metadata?.isFile() || metadata.isSymbolicLink()) {
        throw new Error(`Missing Claude exact rollback payload: ${unit}`);
      }
      await mkdir(dirname(live), { recursive: true });
      await rename(staged, live);
    };
    await restoreExplicitFile(".claude/settings.json", join(CLAUDE_DIR, "settings.json"));
    await restoreExplicitFile(".claude.json", join(homedir(), ".claude.json"));
    await restoreExplicitFile(
      ".claude/.cc-settings-version",
      join(CLAUDE_DIR, ".cc-settings-version"),
    );
  };
  const executeOnce = async (): Promise<number> => {
    let executionTargetOwnership: StagedClaudeOwnership | null;
    try {
      executionTargetOwnership = await validatePreparedStage();
    } catch (cause) {
      throw new StagedClaudeBackupChangedError(cause);
    }
    if (options.currentOwnership) {
      try {
        await assertCurrentClaudeOwnershipMatches(
          options.currentOwnership,
          executionTargetOwnership?.managedFiles,
        );
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new ClaudePrewriteOwnershipChangedError(detail, cause);
      }
      await executeOwnershipScopedRestore(
        Object.keys(options.currentOwnership.managedFiles),
        options.currentOwnership.nodeModulesTarget !== null,
        executionTargetOwnership,
      );
      if (options.announce) success("Restored. Restart Claude Code to apply.");
      return 0;
    }
    if (options.exactSnapshot?.managedFiles !== undefined && options.managedScope) {
      await executeOwnershipScopedRestore(
        options.managedScope,
        options.managedScope.includes("src/node_modules"),
        executionTargetOwnership,
      );
      return 0;
    }
    for (const unit of restoreUnits) {
      const staged = join(staging, unit);
      const live = join(extractCwd, unit);
      const rel = homeRelative ? unit.replace(/^\.claude\//, "") : unit;
      const owned = sharedDirOwnedFiles(rel);
      if (owned) {
        const liveMetadata = await lstat(live).catch(() => null);
        if (options.exactSnapshot && !liveMetadata?.isDirectory()) {
          await rm(live, { recursive: true, force: true });
          if (options.exactSnapshot.present.includes(unit)) {
            if (!existsSync(staged)) {
              throw new Error(`Missing Claude shared-directory compensation payload: ${unit}`);
            }
            await mkdir(dirname(live), { recursive: true });
            await rename(staged, live);
          }
          continue;
        }
        for (const file of owned) {
          const stagedFile = join(staged, file);
          const liveFile = join(live, file);
          const wasPresent = options.exactSnapshot
            ? options.exactSnapshot.sharedOwnedFilesPresent.includes(`${unit}/${file}`)
            : existsSync(stagedFile);
          if (!wasPresent) {
            if (options.exactSnapshot) await rm(liveFile, { force: true });
            continue;
          }
          await mkdir(live, { recursive: true });
          await rm(liveFile, { force: true });
          await rename(stagedFile, liveFile);
        }
        await rmdir(live).catch((cause: NodeJS.ErrnoException) => {
          if (cause.code !== "ENOENT" && cause.code !== "ENOTEMPTY") throw cause;
        });
        continue;
      }

      const wasPresent = options.exactSnapshot
        ? options.exactSnapshot.present.includes(unit)
        : existsSync(staged);
      if (!wasPresent) {
        if (options.exactSnapshot) await rm(live, { recursive: true, force: true });
        continue;
      }
      if (!existsSync(staged)) throw new Error(`Missing Claude compensation payload: ${unit}`);
      await rm(live, { recursive: true, force: true });
      await mkdir(join(live, ".."), { recursive: true });
      await rename(staged, live);
    }
    if (options.announce) success("Restored. Restart Claude Code to apply.");
    return 0;
  };
  return {
    targetManagedPaths: Object.keys(initialTargetOwnership?.managedFiles ?? {}),
    execute: () => {
      execution ??= executeOnce();
      return execution;
    },
    cleanup: async () => {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export async function prepareClaudeRollback(
  target: string | true,
  options: PrepareClaudeRollbackOptions = {},
): Promise<PreparedClaudeRollback | number> {
  const backupDir = `${CLAUDE_DIR}/backups`;
  if (!existsSync(backupDir)) {
    error(`No backups directory found at ${backupDir}`);
    return 1;
  }
  const entries = (await readdir(backupDir))
    .filter((e) => /^backup-.*\.tar\.gz$/.test(e))
    .sort()
    .reverse();
  const match =
    target === true
      ? entries[0]
      : /^\d{14}-\d{3}-\d+-\d+$/.test(target)
        ? entries.find((entry) => entry === `backup-${target}.tar.gz`)
        : entries.find((entry) => entry.includes(target));
  if (!match) {
    error("No matching backup found.");
    console.error("Available backups:");
    for (const e of entries.slice(0, 5)) console.error(`  ${e}`);
    return 1;
  }
  info(`Rolling back from: ${match}`);
  const archivePath = `${backupDir}/${match}`;
  const scheduleSidecar = claudeBackupScheduleSidecar(archivePath);
  const stateSidecar = claudeBackupStateSidecar(archivePath);
  const scheduleMetadata = await lstat(scheduleSidecar).catch(() => null);
  if (!scheduleMetadata?.isFile() || scheduleMetadata.isSymbolicLink()) {
    throw new Error(
      "Claude rollback backup has no safe auto-update scheduler metadata. " +
        "Reinstall cc-settings once before rolling back this legacy backup.",
    );
  }
  const stateMetadata = await lstat(stateSidecar).catch(() => null);
  if (!stateMetadata?.isFile() || stateMetadata.isSymbolicLink()) {
    throw new Error(
      "Claude rollback backup has no safe exact ownership-state metadata. " +
        "Reinstall cc-settings once before rolling back this legacy backup.",
    );
  }
  const autoUpdateSnapshot = parseAutoUpdateState(await readFile(scheduleSidecar, "utf8"));
  await validateAutoUpdateStateSnapshot(autoUpdateSnapshot);
  const exactSnapshot = parseClaudeBackupState(await readFile(stateSidecar, "utf8"), archivePath);
  const currentOwnership = await captureCurrentClaudeOwnership();
  if (exactSnapshot.restoreScope === "managed-absent") {
    await assertManagedAbsentArchiveEmpty(archivePath);
    if (!options.prepareManagedAbsent) {
      throw new Error(
        "This Claude backup records managed state as absent and requires the full installer to restore safely.",
      );
    }
    const managedAbsent = await options.prepareManagedAbsent();
    let execution: Promise<number> | null = null;
    return {
      selectedArchiveName: match,
      targetManagedPaths: [],
      execute: () => {
        execution ??= (async () => {
          try {
            await assertCurrentClaudeOwnershipMatches(currentOwnership);
          } catch (cause) {
            const detail = cause instanceof Error ? cause.message : String(cause);
            throw new ClaudePrewriteOwnershipChangedError(detail, cause);
          }
          const code = await managedAbsent.execute();
          if (code === 0) {
            await options.schedulerPhase?.before();
            await restoreAutoUpdateState(autoUpdateSnapshot);
            await options.schedulerPhase?.after();
          }
          return code;
        })();
        return execution;
      },
      cleanup: () => managedAbsent.cleanup(),
    };
  }
  const prepared = await prepareClaudeArchive(archivePath, {
    requireOwnershipState: true,
    exactSnapshot,
    announce: true,
    currentOwnership,
  });
  if (typeof prepared === "number") return prepared;
  let execution: Promise<number> | null = null;
  return {
    ...prepared,
    selectedArchiveName: match,
    execute: () => {
      execution ??= (async () => {
        const code = await prepared.execute();
        if (code === 0) {
          await options.schedulerPhase?.before();
          await restoreAutoUpdateState(autoUpdateSnapshot);
          await options.schedulerPhase?.after();
        }
        return code;
      })();
      return execution;
    },
  };
}

/** Prepare an exact restore of the bounded Claude state captured before a
 * combined lifecycle. The caller still controls execution and cleanup so it
 * can compensate both products under the same install locks. */
export async function prepareClaudeCompensation(
  snapshot: ClaudeBackupSnapshot,
  additionalManagedScope: readonly string[] = [],
  options: PrepareClaudeCompensationOptions = {},
): Promise<PreparedClaudeRollback> {
  const managedScope = [
    ...new Set([
      ...Object.keys(snapshot.managedFiles ?? {}),
      ...additionalManagedScope,
      ...(additionalManagedScope.length > 0 || snapshot.nodeModulesTarget
        ? ["src/node_modules"]
        : []),
    ]),
  ];
  const initialPrepared = await prepareClaudeArchive(snapshot.archivePath, {
    requireOwnershipState: false,
    exactSnapshot: snapshot,
    announce: false,
    managedScope,
    afterManagedRemoval: options.afterManagedRemoval,
  });
  if (typeof initialPrepared === "number") {
    throw new Error(`Could not prepare Claude compensation (exit ${initialPrepared})`);
  }
  let prepared: PreparedClaudeRollback = initialPrepared;
  let execution: Promise<number> | null = null;
  return {
    execute: () => {
      execution ??= (async () => {
        try {
          return await prepared.execute();
        } catch (cause) {
          if (!(cause instanceof StagedClaudeBackupChangedError)) throw cause;
          await prepared.cleanup();
          const refreshed = await prepareClaudeArchive(snapshot.archivePath, {
            requireOwnershipState: false,
            exactSnapshot: snapshot,
            announce: false,
            managedScope,
            afterManagedRemoval: options.afterManagedRemoval,
          });
          if (typeof refreshed === "number") {
            throw new Error(`Could not refresh Claude compensation (exit ${refreshed})`);
          }
          prepared = refreshed;
          return await prepared.execute();
        }
      })();
      return execution;
    },
    cleanup: async () => {
      await prepared.cleanup();
      if (snapshot.archivePath) await rm(snapshot.archivePath, { force: true });
    },
  };
}

export async function cmdRollback(target: string | true): Promise<number> {
  const prepared = await prepareClaudeRollback(target);
  if (typeof prepared === "number") return prepared;
  try {
    return await prepared.execute();
  } finally {
    await prepared.cleanup();
  }
}
