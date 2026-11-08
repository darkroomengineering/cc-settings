import { realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  assertClaudeLifecycleOwnershipUnchanged,
  type ClaudeLifecycleOwnershipSnapshot,
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
  unownedClaudeUninstallError,
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
import { error, info, phase, success, warn } from "./colors.ts";
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
import { readSettingsBaseline } from "./settings-baseline.ts";
import { type ParsedSentinel, readDestructiveSentinel } from "./version-delta.ts";

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

const AUTO_UPDATE_QUESTION =
  "Enable daily auto-update? Pulls cc-settings and re-runs setup at 10am";

/** Ask the auto-update question before the install starts, when the run would
 *  ask it at all. Returns the answer, or undefined when no question applies;
 *  pass the result to applyAutoUpdate. */
export async function askAutoUpdateUpfront(
  args: InstallArgs,
  prior: boolean | null,
): Promise<boolean | undefined> {
  if (os !== "macos" || !isInteractive() || args.autoUpdate !== null || prior === false) {
    return undefined;
  }
  // Only an enrolled sentinel needs the launchd probe, and the probe touches
  // ~/Library, so it runs after the same boundary check the install lock does.
  let jobPresent = false;
  if (prior === true) {
    await validateClaudeInstallBoundaries();
    jobPresent = await autoUpdateJobLoaded();
  }
  const decision = decideAutoUpdate({
    flag: args.autoUpdate,
    sentinelValue: prior ?? undefined,
    isTTY: true,
    jobPresent,
  });
  if (decision.kind !== "ask") return undefined;
  return promptYn(AUTO_UPDATE_QUESTION, true);
}

export async function applyAutoUpdate(
  args: InstallArgs,
  prior: boolean | null,
  snapshot: AutoUpdateStateSnapshot | null,
  enrolledRepoPath: string,
  upfrontAnswer?: boolean,
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
    enrolled = upfrontAnswer ?? (await promptYn(AUTO_UPDATE_QUESTION, true));
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
  sentinel: ParsedSentinel;
  full: Awaited<ReturnType<typeof composeSettings>>;
  settingsPath: string;
  nodeModulesTarget: string | null;
  snapshot: ClaudeLifecycleOwnershipSnapshot;
  previousTeamSettings: Record<string, unknown> | undefined;
}

async function prepareClaudeUninstall(sourceDir: string): Promise<PreparedClaudeUninstall | null> {
  const sentinel = await readDestructiveSentinel(CLAUDE_DIR);
  if (sentinel === null) return null;
  const nodeModulesTarget = await validateClaudeNodeModulesOwnership(sentinel);
  if (sentinel.ownership.kind === "legacy") throw unownedClaudeUninstallError();
  await validateClaudeManagedFiles(sentinel.ownership, sourceDir, sentinel.profile ?? "full");
  const full = await composeSettings(sourceDir);
  const settingsPath = join(CLAUDE_DIR, "settings.json");
  // Parse every config the uninstall may rewrite before another product is
  // mutated. The cleanup helpers read again during execution, but deterministic
  // corrupt-state failures have already failed closed here.
  await Promise.all([readJsonOrNull(settingsPath), readJsonOrNull(CLAUDE_JSON_PATH)]);
  const managedFiles = sentinel.ownership.kind === "owned" ? sentinel.ownership.files : {};
  const snapshot = await captureClaudeLifecycleOwnership(
    managedFiles,
    Object.keys(managedFiles),
    nodeModulesTarget,
  );
  // Read before removeOwnedClaudeFiles deletes the baseline with the rest of
  // the managed footprint.
  const previousTeamSettings = (await readSettingsBaseline(CLAUDE_DIR))?.team_settings;
  return {
    sourceDir,
    sentinel,
    full,
    settingsPath,
    nodeModulesTarget,
    snapshot,
    previousTeamSettings,
  };
}

async function uninstallClaude(
  prepared: PreparedClaudeUninstall,
  preserveIndependentScheduler = false,
  schedulerPhase?: {
    before: () => Promise<void>;
    after: () => Promise<void>;
  },
): Promise<void> {
  const {
    sourceDir,
    sentinel,
    full,
    settingsPath,
    nodeModulesTarget,
    snapshot,
    previousTeamSettings,
  } = prepared;
  await assertClaudeLifecycleOwnershipUnchanged(snapshot);
  const teamMcp = structuredClone(full.mcpServers ?? {}) as McpServers;
  await pruneSettingsMcpServers(settingsPath, teamMcp, sentinel.mcp_written);
  const current = await readJsonOrNull(settingsPath);
  if (current !== null && typeof current === "object" && !Array.isArray(current)) {
    const { mcpServers: _managedMcp, ...settingsWithoutMcp } = full;
    const cleaned = stripManagedSettings(
      current as Record<string, unknown>,
      settingsWithoutMcp,
      previousTeamSettings,
    );
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
    sentinel.ownership,
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

type CombinedOperation = "install" | "rollback" | "uninstall";

interface CombinedHeld {
  codex: string | null;
  autoUpdate: AutoUpdateStateSnapshot | null;
  drift: ClaudeSharedExplicitDrift;
}

/**
 * One combined Claude/Codex lifecycle. Compensation restores Codex in every
 * phase, Claude files from "files" on, and the auto-update job only in
 * "scheduler". `baseline` is the shared-state snapshot taken when the scheduler
 * step began; null once its drift has been recorded.
 */
export type CombinedTxn =
  | (CombinedHeld & { phase: "unstarted"; claude: PreparedClaudeRollback | null })
  | (CombinedHeld & { phase: "files"; claude: PreparedClaudeRollback })
  | (CombinedHeld & {
      phase: "scheduler";
      claude: PreparedClaudeRollback;
      baseline: ClaudeSharedExplicitSnapshot | null;
    });

export type CombinedTxnEvent =
  | { type: "autoUpdate"; snapshot: AutoUpdateStateSnapshot | null }
  | { type: "claude"; compensation: PreparedClaudeRollback }
  | { type: "codex"; compensation: string | null }
  | { type: "drift"; drift: ClaudeSharedExplicitDrift }
  | { type: "files" }
  | { type: "scheduler"; baseline: ClaudeSharedExplicitSnapshot }
  | { type: "scheduled"; drift: ClaudeSharedExplicitDrift };

function advanceCombinedTxn(txn: CombinedTxn, event: CombinedTxnEvent): CombinedTxn {
  switch (event.type) {
    case "autoUpdate":
    case "claude":
    case "codex":
      if (txn.phase !== "unstarted") {
        throw new Error(`Combined ${event.type} compensation must be held before Claude mutates`);
      }
      if (event.type === "autoUpdate") return { ...txn, autoUpdate: event.snapshot };
      if (event.type === "claude") return { ...txn, claude: event.compensation };
      return { ...txn, codex: event.compensation };
    case "drift":
      return { ...txn, drift: { ...txn.drift, ...event.drift } };
    case "files":
      if (txn.phase !== "unstarted" || txn.claude === null) {
        throw new Error("Claude files phase requires prepared Claude compensation");
      }
      return { ...txn, phase: "files", claude: txn.claude };
    case "scheduler":
      if (txn.phase === "unstarted") {
        throw new Error("Claude scheduler phase requires the files phase");
      }
      return { ...txn, phase: "scheduler", baseline: event.baseline };
    case "scheduled":
      if (txn.phase !== "scheduler") {
        throw new Error("Claude scheduler drift recorded outside the scheduler phase");
      }
      return { ...txn, drift: { ...txn.drift, ...event.drift }, baseline: null };
  }
}

async function restoreCombinedAfterClaudeFailure(txn: CombinedTxn, cause: unknown): Promise<void> {
  const restoreFailures: unknown[] = [];
  if (txn.codex) {
    try {
      await restoreCodexCompensation(txn.codex);
    } catch (restoreCause) {
      restoreFailures.push(restoreCause);
    }
  }
  if (txn.phase !== "unstarted") {
    try {
      await txn.claude.execute();
    } catch (restoreCause) {
      restoreFailures.push(restoreCause);
    }
  }
  if (txn.phase === "scheduler") {
    try {
      await restoreAutoUpdateState(txn.autoUpdate);
    } catch (restoreCause) {
      restoreFailures.push(restoreCause);
    }
  }
  if (txn.phase !== "unstarted") {
    try {
      await restoreClaudeSharedExplicitDrift(txn.drift);
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

async function restoreCodexAfterClaudePrewriteChange(
  codexCompensation: string | null,
  cause: ClaudePrewriteOwnershipChangedError,
  operation: CombinedOperation,
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

/** A forward step. A nonzero exit code stops the run and compensates. */
export type CombinedStep = () => Promise<number | undefined>;

export interface CombinedTransaction {
  readonly state: CombinedTxn;
  dispatch(event: CombinedTxnEvent): void;
  /** Wraps the step that changes the auto-update job (uninstallClaude, prepareClaudeRollback). */
  readonly schedulerPhase: { before(): Promise<void>; after(): Promise<void> };
  /**
   * Runs the steps in order and compensates at most once, on a throw or a
   * nonzero exit code. `cleanup` runs before the held Claude compensation's.
   */
  run(steps: readonly CombinedStep[], cleanup?: () => Promise<void>): Promise<number>;
}

export function createCombinedTxn(operation: CombinedOperation): CombinedTransaction {
  let txn: CombinedTxn = {
    phase: "unstarted",
    claude: null,
    codex: null,
    autoUpdate: null,
    drift: {},
  };
  const dispatch = (event: CombinedTxnEvent): void => {
    txn = advanceCombinedTxn(txn, event);
  };
  const compensate = async (cause: unknown): Promise<void> => {
    const held = txn;
    if (held.claude === null && held.codex === null) return;
    if (cause instanceof ClaudePrewriteOwnershipChangedError) {
      await restoreCodexAfterClaudePrewriteChange(held.codex, cause, operation);
      return;
    }
    if (held.phase === "scheduler" && held.baseline) {
      const drift = await captureClaudeSharedExplicitDriftAfterFailure(held.baseline);
      await restoreCombinedAfterClaudeFailure(
        { ...held, drift: { ...held.drift, ...drift } },
        cause,
      );
      return;
    }
    await restoreCombinedAfterClaudeFailure(held, cause);
  };
  return {
    get state() {
      return txn;
    },
    dispatch,
    schedulerPhase: {
      before: async () => {
        dispatch({ type: "scheduler", baseline: await captureClaudeSharedExplicitState() });
      },
      after: async () => {
        if (txn.phase !== "scheduler" || txn.baseline === null) return;
        dispatch({
          type: "scheduled",
          drift: await captureClaudeSharedExplicitDrift(txn.baseline),
        });
      },
    },
    run: async (steps, cleanup) => {
      try {
        let code = 0;
        try {
          for (const step of steps) {
            code = (await step()) ?? 0;
            if (code !== 0) break;
          }
        } catch (cause) {
          await compensate(cause);
          throw cause;
        }
        if (code !== 0) await compensate(new Error(`Claude ${operation} exited ${code}`));
        return code;
      } finally {
        await cleanup?.();
        await txn.claude?.cleanup();
      }
    },
  };
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
  const txn = createCombinedTxn("rollback");
  const claudePreparation = includesTarget(target, "claude")
    ? await prepareClaudeRollback(selectedBackup, {
        prepareManagedAbsent: async () => {
          const prepared = await prepareClaudeUninstall(sourceDir);
          let execution: Promise<number> | null = null;
          return {
            execute: () => {
              execution ??= prepared
                ? uninstallClaude(prepared, false, txn.schedulerPhase).then(() => 0)
                : Promise.resolve(0);
              return execution;
            },
            cleanup: async () => {},
          };
        },
        schedulerPhase: txn.schedulerPhase,
      })
    : null;
  if (typeof claudePreparation === "number") return claudePreparation;

  let restoredCodexBackup: string | null = null;
  const backupId = target === "both" ? createSharedBackupId() : undefined;
  const code = await txn.run(
    [
      async () => {
        if (!claudePreparation) return;
        txn.dispatch({ type: "autoUpdate", snapshot: await snapshotAutoUpdateState() });
        if (target === "both") {
          await createBackup({
            preserveBackupName: claudePreparation.selectedArchiveName,
            backupId,
          });
        }
        txn.dispatch({
          type: "claude",
          compensation: await prepareClaudeCompensation(
            await createBackup({ temporary: true, backupId }),
            claudePreparation.targetManagedPaths,
          ),
        });
      },
      async () => {
        if (!includesTarget(target, "codex")) return;
        const result = await rollbackCodex({ target: selectedBackup, backupId });
        txn.dispatch({ type: "codex", compensation: result.compensationBackup });
        restoredCodexBackup = result.restoredBackup;
      },
      async () => {
        if (!claudePreparation) return;
        txn.dispatch({ type: "files" });
        return claudePreparation.execute();
      },
    ],
    async () => {
      await claudePreparation?.cleanup();
    },
  );
  if (code !== 0) return code;
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
  const txn = createCombinedTxn("uninstall");
  const backupId = target === "both" ? createSharedBackupId() : undefined;
  await txn.run([
    async () => {
      if (includesTarget(target, "claude") && target === "both") {
        await createBackup({ backupId, managedAbsent: claudePreparation === null });
      }
      if (!claudePreparation) return;
      txn.dispatch({ type: "autoUpdate", snapshot: await snapshotAutoUpdateState() });
      txn.dispatch({
        type: "claude",
        compensation: await prepareClaudeCompensation(
          await createBackup({ temporary: true, backupId }),
        ),
      });
    },
    async () => {
      const claudeSharedBaseline = claudePreparation
        ? await captureClaudeSharedExplicitState()
        : null;
      if (includesTarget(target, "codex")) {
        txn.dispatch({
          type: "codex",
          compensation: await uninstallCodex({ sourceDir, backupId }),
        });
      }
      if (claudeSharedBaseline) {
        txn.dispatch({
          type: "drift",
          drift: await captureClaudeSharedExplicitDrift(claudeSharedBaseline),
        });
      }
    },
    async () => {
      if (!claudePreparation) return;
      txn.dispatch({ type: "files" });
      await uninstallClaude(
        claudePreparation,
        txn.state.autoUpdate?.restoreMode === "independent-preserve-only",
        txn.schedulerPhase,
      );
    },
  ]);
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

  phase("Dependencies");
  await installDependencies(args.profile, engine);
  await installPinnedTools(args.profile);
  printPreflightReport(checkCliTools());

  await assertClaudeLifecycleOwnershipUnchanged(ownershipSnapshot);
  if (backup) {
    phase("Backup");
    await createBackup({ backupId, managedFiles: priorManagedFiles });
    await assertClaudeLifecycleOwnershipUnchanged(ownershipSnapshot);
  }

  phase("Configuration files");
  await removeClaudeFilesWithHashes(priorManagedFiles, priorNodeModulesTarget);
  await createDirectories();
  // Disjoint destination trees (config dirs vs ~/.claude/src), so install both
  // in parallel. Both must follow the clean above. For light, installConfigFiles
  // owns the full footprint: it copies the LIGHT_SKILLS subset and prunes every
  // full-only target (CLAUDE.md, AGENTS.md, agents/, rules/, profiles/, docs/).
  // allSettled so no copy is still writing into ~/.claude when a failure
  // unwinds into compensation.
  const copies = await Promise.allSettled([
    installConfigFiles(args.sourceDir, args.profile),
    installTsSources(args.sourceDir),
  ]);
  for (const copy of copies) if (copy.status === "rejected") throw copy.reason;
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
