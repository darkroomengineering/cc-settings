import { realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  assertClaudeLifecycleOwnershipUnchanged,
  type ClaudeLifecycleOwnershipSnapshot,
  type ClaudeMutationPhase,
  type ClaudeSharedExplicitDrift,
  type ClaudeSharedExplicitSnapshot,
  captureClaudeLifecycleOwnership,
  captureClaudeSharedExplicitDrift,
  captureClaudeSharedExplicitDriftAfterFailure,
  captureClaudeSharedExplicitState,
  hashInstalledProfileFiles,
  removeClaudeFilesWithHashes,
  removeOwnedClaudeFiles,
  restoreClaudeSharedExplicitDrift,
  validateClaudeInstallBoundaries,
  validateClaudeManagedFiles,
  validateClaudeNodeModulesOwnership,
} from "./claude-install-ownership.ts";
import { installDependencies, installPinnedTools } from "./claude-install-settings.ts";
import { currentClaudeManagedSourceFiles } from "./claude-managed-file-manifests.ts";
import { checkCliTools, printPreflightReport } from "./cli-preflight.ts";
import type { EngineDescriptor } from "./code-intel-engine.ts";
import {
  codexInstallPaths,
  listCodexSharedBackupIds,
  restoreCodexCompensation,
  rollbackCodex,
  uninstallCodex,
  validateCodexInstallBoundaries,
} from "./codex-install.ts";
import { error, info, success, warn } from "./colors.ts";
import { composeSettings } from "./compose-settings.ts";
import { writeSrcManifest } from "./hooks-fingerprint.ts";
import {
  ClaudePrewriteOwnershipChangedError,
  listClaudeSharedBackupIds,
  type PreparedClaudeRollback,
  prepareClaudeCompensation,
  prepareClaudeRollback,
} from "./install-cmds.ts";
import {
  createBackup,
  createDirectories,
  installConfigFiles,
  installTsSources,
  preflightInstallSource,
} from "./install-fs.ts";
import { acquireInstallLock, InstallLockError } from "./install-lock.ts";
import { type InstallArgs, type InstallTarget, includesTarget } from "./install-types.ts";
import { atomicWriteJson, readJsonOrNull } from "./json-io.ts";
import { stripManagedSettings } from "./light-profile.ts";
import {
  CLAUDE_JSON_PATH,
  type McpServers,
  pruneSettingsMcpServers,
  removeManagedMcpServers,
} from "./mcp.ts";
import { CLAUDE_DIR, getTimestamp, os } from "./platform.ts";
import { isInteractive, promptYn } from "./prompts.ts";
import {
  type AutoUpdateStateSnapshot,
  autoUpdateJobLoaded,
  decideAutoUpdate,
  registerAutoUpdate,
  restoreAutoUpdateState,
  snapshotAutoUpdateState,
  unregisterAutoUpdate,
} from "./schedule.ts";
import { readDestructiveSentinel, type Sentinel } from "./version-delta.ts";

let sharedBackupSequence = 0;

export function createSharedBackupId(): string {
  const now = new Date();
  return `${getTimestamp(now)}-${String(now.getMilliseconds()).padStart(3, "0")}-${process.pid}-${sharedBackupSequence++}`;
}

// --- Auto-update enrollment ----------------------------------------------

/**
 * Resolve + apply the auto-update enrollment decision, then (re)register or
 * unregister the launchd job to match. macOS-only — on other platforms this
 * only prints a note (once, when the user explicitly tried the flag) and
 * leaves the sentinel field untouched (absent, not "declined").
 *
 * Returns the enrollment value to persist in the sentinel: true/false when a
 * decision was made this run, undefined when nothing should be written
 * (non-macOS, or a non-interactive run with no prior decision).
 */
export function assertAutoUpdateRequestDoesNotClaimIndependentState(
  args: InstallArgs,
  snapshot: AutoUpdateStateSnapshot | null,
): void {
  if (snapshot?.restoreMode === "independent-preserve-only" && args.autoUpdate !== null) {
    throw new Error(
      "An independent same-label auto-update job already exists. Remove or rename it before using --auto-update.",
    );
  }
}

export async function applyAutoUpdate(
  args: InstallArgs,
  prior: boolean | null,
  snapshot: AutoUpdateStateSnapshot | null,
  enrolledRepoPath: string,
): Promise<boolean | undefined> {
  if (os !== "macos") {
    if (args.autoUpdate !== null) warn("--auto-update is macOS-only; ignoring");
    else info("Auto-update is macOS-only — skipping (nothing to enroll on this platform).");
    return undefined;
  }

  if (snapshot?.restoreMode === "independent-preserve-only") {
    return undefined;
  }

  // Corroborate a sentinel claiming auto_update:true against the real
  // launchd job — an unauthenticated sentinel alone must never be able to
  // (re)register a job that isn't actually loaded. See decideAutoUpdate().
  const jobPresent = await autoUpdateJobLoaded();

  const decision = decideAutoUpdate({
    flag: args.autoUpdate,
    sentinelValue: prior ?? undefined,
    isTTY: isInteractive(),
    jobPresent,
  });

  let enrolled: boolean | undefined;
  if (decision.kind === "ask") {
    enrolled = await promptYn(
      "Enable daily auto-update? Pulls cc-settings and re-runs setup at 10am",
      true,
    );
  } else {
    enrolled = decision.enrolled;
  }

  if (enrolled === true) {
    const result = await registerAutoUpdate(CLAUDE_DIR, homedir(), enrolledRepoPath);
    if (result.ok) success("Auto-update enabled — daily at 10:00 local time.");
    else {
      throw new Error(`Auto-update registration failed: ${result.reason ?? "unknown error"}`);
    }
  } else if (enrolled === false) {
    const result = await unregisterAutoUpdate();
    if (!result.ok) throw new Error("Failed to disable the cc-settings auto-update job");
  }

  return enrolled;
}

export async function resolveEnrolledRepoPath(sourceDir: string): Promise<string> {
  const override = process.env.CC_SETTINGS_ENROLLED_REPO;
  if (!override) return sourceDir;

  const expected = process.env.CC_EXPECTED_REPO;
  if (!expected) {
    throw new Error("CC_SETTINGS_ENROLLED_REPO requires the enrolled-path verification pin");
  }
  const [resolvedOverride, resolvedExpected] = await Promise.all([
    realpath(override),
    realpath(expected),
  ]);
  if (resolvedOverride !== resolvedExpected) {
    throw new Error("CC_SETTINGS_ENROLLED_REPO does not match the enrolled-path verification pin");
  }
  return resolvedOverride;
}

interface PreparedClaudeUninstall {
  sourceDir: string;
  sentinel: Sentinel;
  full: Awaited<ReturnType<typeof composeSettings>>;
  settingsPath: string;
  nodeModulesTarget: string | null;
  snapshot: ClaudeLifecycleOwnershipSnapshot;
}

async function prepareClaudeUninstall(sourceDir: string): Promise<PreparedClaudeUninstall | null> {
  const sentinelState = await readDestructiveSentinel(CLAUDE_DIR);
  if (sentinelState === null) return null;
  const sentinel = sentinelState;
  const nodeModulesTarget = await validateClaudeNodeModulesOwnership(sentinel);
  await validateClaudeManagedFiles(
    sentinel.managed_files_state === "managed-absent" ? null : (sentinel.managed_files ?? {}),
    sourceDir,
    sentinel.profile ?? "full",
    sentinel.managed_files_manifest_version,
  );
  const full = await composeSettings(sourceDir);
  const settingsPath = join(CLAUDE_DIR, "settings.json");
  // Parse every config the uninstall may rewrite before another product is
  // mutated. The cleanup helpers read again during execution, but deterministic
  // corrupt-state failures have already failed closed here.
  await Promise.all([readJsonOrNull(settingsPath), readJsonOrNull(CLAUDE_JSON_PATH)]);
  const managedFiles =
    sentinel.managed_files_state === "managed-absent" ? {} : (sentinel.managed_files ?? {});
  const snapshot = await captureClaudeLifecycleOwnership(
    managedFiles,
    Object.keys(managedFiles),
    nodeModulesTarget,
  );
  return { sourceDir, sentinel, full, settingsPath, nodeModulesTarget, snapshot };
}

async function uninstallClaude(
  prepared: PreparedClaudeUninstall,
  preserveIndependentScheduler = false,
  schedulerPhase?: {
    before: () => Promise<void>;
    after: () => Promise<void>;
  },
): Promise<void> {
  const { sourceDir, sentinel, full, settingsPath, nodeModulesTarget, snapshot } = prepared;
  await assertClaudeLifecycleOwnershipUnchanged(snapshot);
  const teamMcp = structuredClone(full.mcpServers ?? {}) as McpServers;
  await pruneSettingsMcpServers(settingsPath, teamMcp, sentinel.mcp_written);
  const current = await readJsonOrNull(settingsPath);
  if (current !== null && typeof current === "object" && !Array.isArray(current)) {
    const { mcpServers: _managedMcp, ...settingsWithoutMcp } = full;
    const cleaned = stripManagedSettings(current as Record<string, unknown>, settingsWithoutMcp);
    for (const key of ["$schema", "statusLine"] as const) {
      if (key in cleaned && JSON.stringify(cleaned[key]) === JSON.stringify(full[key])) {
        delete cleaned[key];
      }
    }
    await atomicWriteJson(settingsPath, cleaned);
  }
  await removeManagedMcpServers(full, CLAUDE_JSON_PATH, sentinel.mcp_written);
  await removeOwnedClaudeFiles(
    sourceDir,
    sentinel.profile ?? "full",
    sentinel.managed_files_state === "managed-absent" ? {} : (sentinel.managed_files ?? null),
    sentinel.managed_files_manifest_version,
    nodeModulesTarget,
  );
  await schedulerPhase?.before();
  const [, scheduleRemoval] = await Promise.all([
    rm(join(CLAUDE_DIR, ".cc-settings-version"), { force: true }),
    preserveIndependentScheduler
      ? Promise.resolve({ ok: true, removed: false })
      : unregisterAutoUpdate(),
  ]);
  if (!scheduleRemoval.ok) throw new Error("Failed to remove the cc-settings auto-update job");
  await schedulerPhase?.after();
}

export async function restoreCombinedAfterClaudeFailure(
  claudeCompensation: PreparedClaudeRollback | null,
  codexCompensation: string | null,
  autoUpdateSnapshot: AutoUpdateStateSnapshot | null,
  cause: unknown,
  claudePhase: ClaudeMutationPhase,
  claudeSharedDrift: ClaudeSharedExplicitDrift = {},
): Promise<void> {
  const restoreFailures: unknown[] = [];
  if (codexCompensation) {
    try {
      await restoreCodexCompensation(codexCompensation);
    } catch (restoreCause) {
      restoreFailures.push(restoreCause);
    }
  }
  if (claudePhase !== "unstarted" && claudeCompensation) {
    try {
      await claudeCompensation.execute();
    } catch (restoreCause) {
      restoreFailures.push(restoreCause);
    }
  }
  if (claudePhase === "scheduler") {
    try {
      await restoreAutoUpdateState(autoUpdateSnapshot);
    } catch (restoreCause) {
      restoreFailures.push(restoreCause);
    }
  }
  if (claudePhase !== "unstarted") {
    try {
      await restoreClaudeSharedExplicitDrift(claudeSharedDrift);
    } catch (restoreCause) {
      restoreFailures.push(restoreCause);
    }
  }
  if (restoreFailures.length > 0) {
    throw new AggregateError(
      [cause, ...restoreFailures],
      "Combined Claude/Codex operation failed and exact compensation was incomplete",
    );
  }
}

export async function restoreCodexAfterClaudePrewriteChange(
  codexCompensation: string | null,
  cause: ClaudePrewriteOwnershipChangedError,
  operation: "install" | "uninstall",
): Promise<void> {
  if (!codexCompensation) return;
  try {
    await restoreCodexCompensation(codexCompensation);
  } catch (restoreCause) {
    throw new AggregateError(
      [cause, restoreCause],
      `Combined ${operation} detected a concurrent Claude edit and Codex compensation failed`,
    );
  }
}

export async function runSelectedRollback(
  target: Exclude<InstallTarget, "auto">,
  backup: string | true,
  sourceDir: string,
): Promise<number> {
  let selectedBackup = backup;
  if (target === "both") {
    const [claudeIds, codexIds] = await Promise.all([
      listClaudeSharedBackupIds(),
      listCodexSharedBackupIds(),
    ]);
    const codexIdSet = new Set(codexIds);
    const commonIds = claudeIds.filter((id) => codexIdSet.has(id));
    if (backup === true) {
      const newestCommonId = commonIds[0];
      if (!newestCommonId) {
        throw new Error("No paired Claude/Codex backup found for combined rollback");
      }
      selectedBackup = newestCommonId;
    } else {
      const matches = commonIds.filter((id) => id.includes(backup));
      if (matches.length === 0) {
        throw new Error(
          `No paired Claude/Codex backup matches ${backup}. Available paired backups: ${commonIds.slice(0, 5).join(", ") || "none"}`,
        );
      }
      if (matches.length > 1) {
        throw new Error(
          `Paired Claude/Codex backup target ${backup} is ambiguous. Use a longer or full backup ID.`,
        );
      }
      selectedBackup = matches[0] as string;
    }
  }
  let claudePhase: ClaudeMutationPhase = "unstarted";
  let schedulerSharedBaseline: ClaudeSharedExplicitSnapshot | null = null;
  let claudeSharedDrift: ClaudeSharedExplicitDrift = {};
  const schedulerPhase = {
    before: async (): Promise<void> => {
      schedulerSharedBaseline = await captureClaudeSharedExplicitState();
      claudePhase = "scheduler";
    },
    after: async (): Promise<void> => {
      if (!schedulerSharedBaseline) return;
      claudeSharedDrift = {
        ...claudeSharedDrift,
        ...(await captureClaudeSharedExplicitDrift(schedulerSharedBaseline)),
      };
      schedulerSharedBaseline = null;
    },
  };
  const claudePreparation = includesTarget(target, "claude")
    ? await prepareClaudeRollback(selectedBackup, {
        prepareManagedAbsent: async () => {
          const prepared = await prepareClaudeUninstall(sourceDir);
          let execution: Promise<number> | null = null;
          return {
            execute: () => {
              execution ??= prepared
                ? uninstallClaude(prepared, false, schedulerPhase).then(() => 0)
                : Promise.resolve(0);
              return execution;
            },
            cleanup: async () => {},
          };
        },
        schedulerPhase,
      })
    : null;
  if (typeof claudePreparation === "number") return claudePreparation;

  let claudeCompensation: PreparedClaudeRollback | null = null;
  let codexCompensation: string | null = null;
  let restoredCodexBackup: string | null = null;
  let claudeCode = 0;
  let autoUpdateSnapshot: AutoUpdateStateSnapshot | null = null;
  let compensationAttempted = false;
  const backupId = target === "both" ? createSharedBackupId() : undefined;
  const compensate = async (cause: unknown): Promise<void> => {
    compensationAttempted = true;
    if (cause instanceof ClaudePrewriteOwnershipChangedError) {
      if (!codexCompensation) return;
      try {
        await restoreCodexCompensation(codexCompensation);
      } catch (restoreCause) {
        throw new AggregateError(
          [cause, restoreCause],
          "Combined rollback detected a concurrent Claude edit and Codex compensation failed",
        );
      }
      return;
    }
    if (claudePhase === "scheduler" && schedulerSharedBaseline) {
      claudeSharedDrift = {
        ...claudeSharedDrift,
        ...(await captureClaudeSharedExplicitDriftAfterFailure(schedulerSharedBaseline)),
      };
    }
    await restoreCombinedAfterClaudeFailure(
      claudeCompensation,
      codexCompensation,
      autoUpdateSnapshot,
      cause,
      claudePhase,
      claudeSharedDrift,
    );
  };
  try {
    if (claudePreparation) {
      autoUpdateSnapshot = await snapshotAutoUpdateState();
      if (target === "both") {
        await createBackup({
          preserveBackupName: claudePreparation?.selectedArchiveName,
          backupId,
        });
      }
      claudeCompensation = await prepareClaudeCompensation(
        await createBackup({ temporary: true, backupId }),
        claudePreparation.targetManagedPaths,
      );
    }
    if (includesTarget(target, "codex")) {
      const result = await rollbackCodex({ target: selectedBackup, backupId });
      codexCompensation = result.compensationBackup;
      restoredCodexBackup = result.restoredBackup;
    }
    if (claudePreparation) {
      claudePhase = "files";
      claudeCode = await claudePreparation.execute();
    }
    if (claudeCode !== 0) {
      if (claudeCompensation || codexCompensation) {
        await compensate(new Error(`Claude rollback exited ${claudeCode}`));
      }
      return claudeCode;
    }
  } catch (cause) {
    if (!compensationAttempted && (claudeCompensation || codexCompensation)) {
      await compensate(cause);
    }
    throw cause;
  } finally {
    await claudePreparation?.cleanup();
    await claudeCompensation?.cleanup();
  }
  if (restoredCodexBackup) success(`Codex restored from backup ${restoredCodexBackup}`);
  return 0;
}

export async function runSelectedUninstall(
  target: Exclude<InstallTarget, "auto">,
  sourceDir: string,
): Promise<number> {
  const claudePreparation = includesTarget(target, "claude")
    ? await prepareClaudeUninstall(sourceDir)
    : null;
  let claudeCompensation: PreparedClaudeRollback | null = null;
  let codexCompensation: string | null = null;
  let autoUpdateSnapshot: AutoUpdateStateSnapshot | null = null;
  let claudeSharedDrift: ClaudeSharedExplicitDrift = {};
  let schedulerSharedBaseline: ClaudeSharedExplicitSnapshot | null = null;
  let claudePhase: ClaudeMutationPhase = "unstarted";
  const currentClaudePhase = (): ClaudeMutationPhase => claudePhase;
  const backupId = target === "both" ? createSharedBackupId() : undefined;
  try {
    if (includesTarget(target, "claude") && target === "both") {
      await createBackup({ backupId, managedAbsent: claudePreparation === null });
    }
    if (claudePreparation) {
      autoUpdateSnapshot = await snapshotAutoUpdateState();
      claudeCompensation = await prepareClaudeCompensation(
        await createBackup({ temporary: true, backupId }),
      );
    }
    const claudeSharedBaseline = claudePreparation
      ? await captureClaudeSharedExplicitState()
      : null;
    if (includesTarget(target, "codex")) {
      codexCompensation = await uninstallCodex({ sourceDir, backupId });
    }
    if (claudeSharedBaseline) {
      claudeSharedDrift = await captureClaudeSharedExplicitDrift(claudeSharedBaseline);
    }
    if (claudePreparation) {
      claudePhase = "files";
      await uninstallClaude(
        claudePreparation,
        autoUpdateSnapshot?.restoreMode === "independent-preserve-only",
        {
          before: async () => {
            schedulerSharedBaseline = await captureClaudeSharedExplicitState();
            claudePhase = "scheduler";
          },
          after: async () => {
            if (!schedulerSharedBaseline) return;
            claudeSharedDrift = {
              ...claudeSharedDrift,
              ...(await captureClaudeSharedExplicitDrift(schedulerSharedBaseline)),
            };
            schedulerSharedBaseline = null;
          },
        },
      );
    }
  } catch (cause) {
    if (cause instanceof ClaudePrewriteOwnershipChangedError) {
      await restoreCodexAfterClaudePrewriteChange(codexCompensation, cause, "uninstall");
      throw cause;
    }
    if (currentClaudePhase() === "scheduler" && schedulerSharedBaseline) {
      claudeSharedDrift = {
        ...claudeSharedDrift,
        ...(await captureClaudeSharedExplicitDriftAfterFailure(schedulerSharedBaseline)),
      };
    }
    if (claudeCompensation || codexCompensation) {
      await restoreCombinedAfterClaudeFailure(
        claudeCompensation,
        codexCompensation,
        autoUpdateSnapshot,
        cause,
        currentClaudePhase(),
        claudeSharedDrift,
      );
    }
    throw cause;
  } finally {
    await claudeCompensation?.cleanup();
  }
  success(`Removed cc-settings from ${target === "both" ? "Claude and Codex" : target}`);
  // Plugins are never auto-removed (a user may still want fast-jev-compaction
  // or compaction-trigger without the rest of cc-settings) — just point at
  // the command that does.
  if (includesTarget(target, "claude")) {
    info(
      "Plugins fast-jev-compaction, compaction-trigger, context-report and drift-fuse were left installed: " +
        "claude plugin remove fast-jev-compaction@fast-jev-compaction && " +
        "claude plugin remove compaction-trigger@cc-settings && " +
        "claude plugin remove context-report@cc-settings && " +
        "claude plugin remove drift-fuse@cc-settings",
    );
  }
  return 0;
}

// --- Main ----------------------------------------------------------------

/**
 * Run the full install path: deps → backup → dirs → clean → light-incompatible
 * removal → file copy → TS source copy → src manifest.
 *
 * PHASE ORDER IS CORRECTNESS-CRITICAL:
 *   clean before copy; fingerprint after settings write; manifest write for
 *   tamper defense. Do not reorder.
 */
export async function runFullInstall(
  args: InstallArgs,
  engine: EngineDescriptor,
  priorManagedFiles: Record<string, string>,
  priorNodeModulesTarget: string | null,
  ownershipSnapshot: ClaudeLifecycleOwnershipSnapshot,
  backup: boolean = true,
  backupId?: string,
): Promise<Record<string, string>> {
  // Preflight BEFORE any destructive step. A bad --source (partial checkout,
  // wrong path) must abort here — while the existing install is still intact —
  // not after cleanOldConfig() has already wiped the managed footprint. Two
  // pre-clean gates: the source footprint is complete for this profile, and the
  // config/ fragments compose to a valid settings.json. composeSettings is
  // side-effect-free and runs again inside installSettings; the redundant read
  // of four small JSON files is a deliberate trade for a fail-closed guard.
  preflightInstallSource(args.sourceDir, args.profile);
  await composeSettings(args.sourceDir);

  info("Installing dependencies...");
  await installDependencies(args.profile, engine);
  await installPinnedTools(args.profile);
  printPreflightReport(checkCliTools());

  await assertClaudeLifecycleOwnershipUnchanged(ownershipSnapshot);
  if (backup) {
    info("Creating backup...");
    await createBackup({ backupId, managedFiles: priorManagedFiles });
    await assertClaudeLifecycleOwnershipUnchanged(ownershipSnapshot);
  }

  info("Installing configuration...");
  await removeClaudeFilesWithHashes(priorManagedFiles, priorNodeModulesTarget);
  await createDirectories();
  // Disjoint destination trees (config dirs vs ~/.claude/src), so install both
  // in parallel. Both must follow the clean above. For light, installConfigFiles
  // owns the full footprint: it copies the LIGHT_SKILLS subset and prunes every
  // full-only target (CLAUDE.md, AGENTS.md, agents/, rules/, profiles/, docs/).
  await Promise.all([
    installConfigFiles(args.sourceDir, args.profile),
    installTsSources(args.sourceDir),
  ]);
  // Content manifest of the just-installed ~/.claude/src tree — the
  // supply-chain layer that catches dropped/patched script content. A failed
  // write aborts because the sentinel must never claim missing metadata.
  const managedRuntimeFiles = currentClaudeManagedSourceFiles(args.profile)
    .map(({ destination }) => destination)
    .filter((destination) => destination.startsWith("src/"))
    .map((destination) => destination.slice("src/".length));
  await writeSrcManifest(join(CLAUDE_DIR, "src"), CLAUDE_DIR, managedRuntimeFiles);
  return await hashInstalledProfileFiles(args.sourceDir, args.profile);
}

function installLockPaths(target: Exclude<InstallTarget, "auto">): string[] {
  const paths: string[] = [];
  if (includesTarget(target, "claude")) paths.push(join(CLAUDE_DIR, "tmp", "install.lock"));
  if (includesTarget(target, "codex")) {
    paths.push(join(codexInstallPaths().codexHome, "tmp", "install.lock"));
  }
  return [...new Set(paths)].sort();
}

/** Run fn while holding the selected products' install locks.
 *  Returns 1 with a message if another install already holds it; otherwise
 *  returns fn's exit code and releases locks in reverse acquisition order. */
export async function underInstallLock(
  target: Exclude<InstallTarget, "auto">,
  fn: () => Promise<number>,
): Promise<number> {
  if (includesTarget(target, "claude")) await validateClaudeInstallBoundaries();
  if (includesTarget(target, "codex")) await validateCodexInstallBoundaries();
  const releases: Array<() => Promise<void>> = [];
  const releaseAll = async (): Promise<unknown[]> => {
    const failures: unknown[] = [];
    for (const release of releases.reverse()) {
      try {
        await release();
      } catch (err) {
        failures.push(err);
      }
    }
    return failures;
  };
  try {
    for (const lockPath of installLockPaths(target)) {
      releases.push(await acquireInstallLock(lockPath));
    }
  } catch (err) {
    const cleanupFailures = await releaseAll();
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [err, ...cleanupFailures],
        "Install lock acquisition and cleanup failed",
      );
    }
    if (err instanceof InstallLockError) {
      error(err.message);
      return 1;
    }
    throw err;
  }
  let exitCode = 1;
  const failures: unknown[] = [];
  try {
    exitCode = await fn();
  } catch (err) {
    failures.push(err);
  }
  failures.push(...(await releaseAll()));
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Install operation and lock cleanup failed");
  }
  return exitCode;
}
