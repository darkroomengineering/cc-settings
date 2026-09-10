import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  createCodexBackup,
  exactCompensationBackup,
  prepareManagedSourceFromBackup,
  readBackupManifest,
  removeCurrentManagedCodexState,
  resolveBackup,
  restoreBackupPath,
  restoreCodexAfterFailure,
  restoreCodexBackupExact,
  restorePluginStateAndConfig,
} from "./codex-backup.ts";
import {
  assertCodexBoundaries,
  assertCodexExplicitStateUnchanged,
  assertCodexSentinelUnchanged,
  assertManagedAgentBoundaries,
  backupRelativePath,
  type CodexDryRunOptions,
  type CodexInstallOptions,
  type CodexInstallPaths,
  type CodexProfile,
  type CodexRollbackOptions,
  type CodexRollbackResult,
  type CodexSentinel,
  type CodexStatus,
  type CodexStatusOptions,
  type CodexUninstallOptions,
  captureCodexExplicitState,
  captureCodexExplicitStateDrift,
  codexCliAvailable,
  codexInstallPaths,
  contentHash,
  copyIfPresent,
  INSTRUCTIONS_END,
  INSTRUCTIONS_START,
  isCodexCliSkippedForTests,
  MANAGED_RULE_NAME,
  readSentinel,
  refreshOperationOwnedInstructions,
  removeFileWithHash,
  restoreCodexExplicitStateDrift,
  STRICT_VERSION,
  toPluginState,
} from "./codex-install-state.ts";
import {
  assertInstructionsMergeable,
  assertNoNativeCollisions,
  assertSentinelAgentOwnership,
  managedBlockRange,
  removeAgentFiles,
  serializeNativeAgent,
  shippedNativeAgentNames,
  writeManagedInstructions,
} from "./codex-native-agents.ts";
import {
  assertManagedPluginProvenance,
  discoverPlugin,
  installPlugin,
  readCodexPluginState,
  removePlugin,
} from "./codex-plugin.ts";
import {
  assertPreviousManagedContentUnmodified,
  installPreparedManagedSource,
  preflightCodexSource,
  prepareManagedSource,
  runtimeManifestHashes,
} from "./codex-runtime.ts";
import { CURRENT_RUNTIME_MANIFEST_VERSION } from "./codex-runtime-manifests.ts";
import { readJsonOrNull } from "./json-io.ts";
import { formatLegacyCodexSkillOverlap, scanLegacyCodexSkills } from "./managed-skills.ts";
import { isPlainObject } from "./merge-keyed.ts";
import { compareVersion } from "./version-delta.ts";

export { listCodexSharedBackupIds } from "./codex-backup.ts";
export type {
  CodexDryRunOptions,
  CodexInstallOptions,
  CodexInstallPaths,
  CodexProfile,
  CodexRollbackOptions,
  CodexRollbackResult,
  CodexStatus,
  CodexStatusOptions,
  CodexUninstallOptions,
} from "./codex-install-state.ts";
export {
  codexCliAvailable,
  codexInstallPaths,
  isCodexCliSkippedForTests,
  looksLikeCodexVersion,
  readCodexInstalledVersion,
  resetCodexCliAvailabilityMemoForTests,
  validateCodexInstallBoundaries,
  validateProductRootDisjointness,
} from "./codex-install-state.ts";

async function assertFirstInstallDestinationsAbsent(
  paths: CodexInstallPaths,
  names: string[],
  profile: CodexProfile,
): Promise<void> {
  const conflicts: string[] = [];
  const managedDestinations = [paths.managedSource];
  if (profile === "full") {
    managedDestinations.push(
      join(paths.rulesDir, MANAGED_RULE_NAME),
      ...names.map((name) => join(paths.agentsDir, `${name}.toml`)),
    );
  }
  for (const path of managedDestinations) {
    if (await lstat(path).catch(() => null)) conflicts.push(path);
  }
  const instructions = await readFile(paths.globalInstructionsPath, "utf8").catch(() => null);
  if (instructions !== null && managedBlockRange(instructions)) {
    conflicts.push(`${paths.globalInstructionsPath} managed block`);
  }
  if (profile === "full") {
    const pluginState = await readCodexPluginState(paths);
    if (pluginState?.pluginInstalled || pluginState?.marketplaceEnrolled) {
      conflicts.push("darkroom@cc-settings plugin or cc-settings marketplace");
    }
  }
  if (conflicts.length > 0) {
    throw new Error(`Codex install found unowned managed destinations: ${conflicts.join(", ")}`);
  }
}

export async function installCodex(options: CodexInstallOptions): Promise<string> {
  const paths = codexInstallPaths(options.homeDir);
  const sourceDir = resolve(options.sourceDir);
  const agents = await preflightCodexSource(sourceDir);
  if (options.profile === "full" && !isCodexCliSkippedForTests() && !codexCliAvailable()) {
    throw new Error("Codex CLI is required for a full Codex install");
  }
  if (options.profile === "full") {
    const warning = formatLegacyCodexSkillOverlap(await scanLegacyCodexSkills(paths.homeDir));
    if (warning) console.warn(warning);
  }
  await assertCodexBoundaries(paths);
  const names = agents.map((agent) => agent.name);
  const nextManagedAgents = options.profile === "full" ? names : [];
  const previous = await readSentinel(paths.sentinelPath);
  assertSentinelAgentOwnership(previous, await shippedNativeAgentNames(), paths.sentinelPath);
  if (previous) {
    await assertPreviousManagedContentUnmodified(paths, previous, true);
  } else {
    await assertFirstInstallDestinationsAbsent(paths, names, options.profile);
  }
  if (previous?.profile === "light" && options.profile === "full") {
    const pluginState = await readCodexPluginState(paths);
    if (pluginState?.pluginInstalled || pluginState?.marketplaceEnrolled) {
      throw new Error(
        "Codex full install found an independently managed darkroom plugin or cc-settings marketplace",
      );
    }
  }
  if (
    options.profile === "light" &&
    previous?.profile === "full" &&
    !isCodexCliSkippedForTests() &&
    !codexCliAvailable()
  ) {
    throw new Error("Codex CLI is required to remove managed plugin or marketplace state");
  }
  await assertManagedAgentBoundaries(paths, [...(previous?.managed_agents ?? []), ...names]);
  await assertInstructionsMergeable(paths);
  if (options.profile === "full") await assertNoNativeCollisions(paths, names, previous);
  const explicitState = await captureCodexExplicitState(paths);
  const backup = await createCodexBackup(
    paths,
    nextManagedAgents,
    new Set(),
    options.backupId,
    options.profile === "full" || previous?.profile === "full",
  );
  const preparedSource = await prepareManagedSource(sourceDir, paths);
  await assertCodexSentinelUnchanged(paths, previous);
  if (previous) {
    await assertPreviousManagedContentUnmodified(paths, previous, true);
    await assertManagedPluginProvenance(paths, previous, await readCodexPluginState(paths));
  } else {
    await assertFirstInstallDestinationsAbsent(paths, names, options.profile);
  }
  if (previous?.profile === "light" && options.profile === "full") {
    const pluginState = await readCodexPluginState(paths);
    if (pluginState?.pluginInstalled || pluginState?.marketplaceEnrolled) {
      throw new Error("Codex plugin state changed during full-install preparation");
    }
  }
  await assertInstructionsMergeable(paths);
  if (options.profile === "full") await assertNoNativeCollisions(paths, names, previous);
  await assertCodexExplicitStateUnchanged(paths, explicitState);
  let operationExplicitState = explicitState;
  try {
    await mkdir(paths.codexHome, { recursive: true });
    await installPreparedManagedSource(paths, preparedSource);
    const managedInstructionsHash = await writeManagedInstructions(sourceDir, paths);
    operationExplicitState = await refreshOperationOwnedInstructions(paths, operationExplicitState);

    await mkdir(paths.agentsDir, { recursive: true });
    await removeAgentFiles(paths, previous?.managed_agents ?? [], previous?.managed_agent_hashes);
    if (previous?.profile === "full") {
      await removeFileWithHash(join(paths.rulesDir, MANAGED_RULE_NAME), previous.managed_rule_hash);
    }
    const managedAgentHashes: Record<string, string> = {};
    let managedRuleHash: string | undefined;
    if (options.profile === "full") {
      for (const agent of agents) {
        const serialized = serializeNativeAgent(agent, paths);
        await writeFile(join(paths.agentsDir, `${agent.name}.toml`), serialized);
        managedAgentHashes[agent.name] = contentHash(serialized);
      }
      await mkdir(paths.rulesDir, { recursive: true });
      const ruleSource = join(sourceDir, "codex", "rules", MANAGED_RULE_NAME);
      const ruleDestination = join(paths.rulesDir, MANAGED_RULE_NAME);
      await cp(ruleSource, ruleDestination);
      managedRuleHash = contentHash(await readFile(ruleDestination));
      await installPlugin(paths);
    } else {
      if (previous?.profile === "full") {
        await removePlugin(paths, true);
      }
    }

    const sentinel: CodexSentinel = {
      version: options.version,
      installed_at: new Date().toISOString(),
      profile: options.profile,
      repo_path: sourceDir,
      managed_agents: nextManagedAgents,
      managed_agent_hashes: managedAgentHashes,
      managed_source_hashes: await runtimeManifestHashes(paths.managedSource),
      managed_instructions_hash: managedInstructionsHash,
      runtime_manifest_version: CURRENT_RUNTIME_MANIFEST_VERSION,
      ...(managedRuleHash ? { managed_rule_hash: managedRuleHash } : {}),
    };
    await writeFile(paths.sentinelPath, `${JSON.stringify(sentinel, null, 2)}\n`);
    return basename(backup);
  } catch (cause) {
    const explicitDrift = await captureCodexExplicitStateDrift(paths, operationExplicitState);
    if (!previous && options.profile === "full") {
      const restoreFailures: unknown[] = [];
      try {
        // First-install preflight proved this identity absent. Any enrollment
        // now present was created by this operation, even if installPlugin
        // failed between marketplace and plugin registration.
        await removePlugin(paths, true);
      } catch (cleanupCause) {
        restoreFailures.push(cleanupCause);
      }
      try {
        await restoreCodexBackupExact(paths, backup);
      } catch (restoreCause) {
        restoreFailures.push(restoreCause);
      }
      try {
        await restoreCodexExplicitStateDrift(paths, explicitDrift);
      } catch (restoreCause) {
        restoreFailures.push(restoreCause);
      }
      if (restoreFailures.length > 0) {
        throw new AggregateError(
          [cause, ...restoreFailures],
          `Codex install failed and first-install enrollment compensation was incomplete: ${backup}`,
        );
      }
      throw cause;
    }
    return await restoreCodexAfterFailure(paths, backup, cause, "install", explicitDrift);
  } finally {
    await rm(preparedSource, { recursive: true, force: true }).catch(() => {});
  }
}

/** Restore one exact pre-operation snapshot returned by a Codex lifecycle. */
export async function restoreCodexCompensation(
  backupName: string,
  options: { homeDir?: string } = {},
): Promise<void> {
  const paths = codexInstallPaths(options.homeDir);
  await assertCodexBoundaries(paths);
  await restoreCodexBackupExact(paths, exactCompensationBackup(paths, backupName));
}

export async function rollbackCodex(options: CodexRollbackOptions): Promise<CodexRollbackResult> {
  const paths = codexInstallPaths(options.homeDir);
  await assertCodexBoundaries(paths);
  // Resolve and validate the requested snapshot before creating the new
  // compensation snapshot, otherwise bare --rollback would select itself.
  const backup = await resolveBackup(paths, options.target);
  const manifest = await readBackupManifest(backup, paths);
  if (
    manifest.pluginState?.restoreMode === "managed-restorable" &&
    manifest.pluginState.pluginInstalled &&
    !manifest.pluginState.pluginEnabled
  ) {
    throw new Error(
      "The selected Codex backup contains a disabled darkroom plugin, and this Codex CLI has no supported command to restore that state exactly.",
    );
  }
  if (manifest.pluginState?.restoreMode === "independent-preserve-only") {
    const livePluginState = await readCodexPluginState(paths);
    const selectedPluginState = toPluginState(manifest.pluginState);
    if (
      livePluginState === null ||
      JSON.stringify(livePluginState) !== JSON.stringify(selectedPluginState)
    ) {
      throw new Error(
        "Codex rollback cannot recreate independent preserve-only plugin provenance. Restore the selected plugin and marketplace state exactly, then retry rollback.",
      );
    }
  }
  const present = new Set(manifest.present);
  const current = await readSentinel(paths.sentinelPath);
  assertSentinelAgentOwnership(current, await shippedNativeAgentNames(), paths.sentinelPath);
  if (current) await assertPreviousManagedContentUnmodified(paths, current, true);
  if (current?.profile !== "full" && manifest.restoredProfile === "full") {
    const currentPluginState = await readCodexPluginState(paths);
    if (currentPluginState?.pluginInstalled || currentPluginState?.marketplaceEnrolled) {
      throw new Error(
        "Codex rollback found an independently managed darkroom plugin or cc-settings marketplace",
      );
    }
  }
  if (
    !isCodexCliSkippedForTests() &&
    !codexCliAvailable() &&
    (current?.profile === "full" ||
      manifest.restoredProfile === "full" ||
      manifest.pluginState?.pluginInstalled === true ||
      manifest.pluginState?.marketplaceEnrolled === true)
  ) {
    throw new Error("Codex CLI is required to change recorded plugin or marketplace state");
  }
  await assertManagedAgentBoundaries(paths, [
    ...(current?.managed_agents ?? []),
    ...manifest.nextManagedAgents,
    ...manifest.previousManagedAgents,
  ]);
  const explicitState = await captureCodexExplicitState(paths);
  const compensation = await createCodexBackup(
    paths,
    manifest.previousManagedAgents,
    new Set([backup]),
    options.backupId,
    current?.profile === "full" || manifest.pluginState?.restoreMode === "managed-restorable",
    current === null && manifest.restoreScope === "managed-absent",
  );
  if (manifest.restoreScope === "managed-absent") {
    await assertCodexExplicitStateUnchanged(paths, explicitState);
    try {
      await restoreCodexBackupExact(paths, backup);
      return {
        restoredBackup: basename(backup),
        compensationBackup: basename(compensation),
      };
    } catch (cause) {
      return await restoreCodexAfterFailure(paths, compensation, cause, "rollback");
    }
  }
  const preparedSource = await prepareManagedSourceFromBackup(
    paths,
    backup,
    present,
    manifest.runtimeManifestVersion,
  );
  const refreshedManifest = await readBackupManifest(backup, paths);
  if (JSON.stringify(refreshedManifest) !== JSON.stringify(manifest)) {
    throw new Error("Selected Codex backup changed during rollback preparation");
  }
  await assertCodexSentinelUnchanged(paths, current);
  if (current) {
    await assertPreviousManagedContentUnmodified(paths, current, true);
    await assertManagedPluginProvenance(paths, current, await readCodexPluginState(paths));
  }
  if (manifest.pluginState?.restoreMode === "independent-preserve-only") {
    const livePluginState = await readCodexPluginState(paths);
    const expectedPluginState = toPluginState(manifest.pluginState);
    if (
      livePluginState === null ||
      JSON.stringify(livePluginState) !== JSON.stringify(expectedPluginState)
    ) {
      throw new Error("Codex preserve-only plugin state changed during rollback preparation");
    }
  }
  const targetProfile = manifest.restoredProfile ?? "light";
  if (!current) {
    await assertFirstInstallDestinationsAbsent(
      paths,
      manifest.previousManagedAgents,
      targetProfile,
    );
  } else {
    const currentAgents = new Set(current.managed_agents);
    const collisions: string[] = [];
    for (const name of manifest.previousManagedAgents) {
      if (currentAgents.has(name)) continue;
      const path = join(paths.agentsDir, `${name}.toml`);
      if (await lstat(path).catch(() => null)) collisions.push(path);
    }
    const rulePath = join(paths.rulesDir, MANAGED_RULE_NAME);
    if (
      targetProfile === "full" &&
      current.profile !== "full" &&
      (await lstat(rulePath).catch(() => null))
    ) {
      collisions.push(rulePath);
    }
    if (collisions.length > 0) {
      throw new Error(`Codex rollback target changed during preparation: ${collisions.join(", ")}`);
    }
    if (targetProfile === "full" && current.profile !== "full") {
      const pluginState = await readCodexPluginState(paths);
      if (pluginState?.pluginInstalled || pluginState?.marketplaceEnrolled) {
        throw new Error("Codex plugin state changed during rollback preparation");
      }
    }
  }
  await assertCodexExplicitStateUnchanged(paths, explicitState);
  let operationExplicitState = explicitState;
  try {
    if (current?.profile === "full" || manifest.pluginState?.restoreMode === "managed-restorable") {
      await removePlugin(
        paths,
        current?.profile === "full" ||
          manifest.pluginState?.pluginInstalled === true ||
          manifest.pluginState?.marketplaceEnrolled === true,
      );
    }
    await removeAgentFiles(paths, current?.managed_agents ?? [], current?.managed_agent_hashes);
    for (const name of manifest.previousManagedAgents) {
      const rel = join("agents", `${name}.toml`);
      if (present.has(rel) && !existsSync(join(paths.codexHome, rel))) {
        await copyIfPresent(join(backup, "files", rel), join(paths.codexHome, rel));
      }
    }
    const rulePath = join(paths.rulesDir, MANAGED_RULE_NAME);
    await removeFileWithHash(rulePath, current?.managed_rule_hash);
    const ruleRel = backupRelativePath(rulePath, paths);
    if (!existsSync(rulePath) && present.has(ruleRel)) {
      await copyIfPresent(join(backup, "files", ruleRel), rulePath);
    }
    await installPreparedManagedSource(paths, preparedSource);
    await restoreBackupPath(
      backup,
      backupRelativePath(paths.sentinelPath, paths),
      paths.sentinelPath,
      present,
    );
    await restoreBackupPath(
      backup,
      backupRelativePath(paths.globalInstructionsPath, paths),
      paths.globalInstructionsPath,
      present,
    );
    operationExplicitState = await refreshOperationOwnedInstructions(paths, operationExplicitState);
    await restorePluginStateAndConfig(paths, backup, present, manifest.pluginState);
    return {
      restoredBackup: basename(backup),
      compensationBackup: basename(compensation),
    };
  } catch (cause) {
    const explicitDrift = await captureCodexExplicitStateDrift(paths, operationExplicitState);
    return await restoreCodexAfterFailure(paths, compensation, cause, "rollback", explicitDrift);
  } finally {
    if (preparedSource) {
      await rm(preparedSource, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function uninstallCodex(options: CodexUninstallOptions = {}): Promise<string> {
  const paths = codexInstallPaths(options.homeDir);
  await assertCodexBoundaries(paths);
  const sentinel = await readSentinel(paths.sentinelPath);
  assertSentinelAgentOwnership(sentinel, await shippedNativeAgentNames(), paths.sentinelPath);
  if (!sentinel) {
    if (!options.backupId) return "";
    return basename(await createCodexBackup(paths, [], new Set(), options.backupId, false, true));
  }
  await assertPreviousManagedContentUnmodified(paths, sentinel, true);
  if (sentinel?.profile === "full" && !isCodexCliSkippedForTests() && !codexCliAvailable()) {
    throw new Error("Codex CLI is required to remove managed plugin or marketplace state");
  }
  await assertManagedAgentBoundaries(paths, sentinel?.managed_agents ?? []);
  const explicitState = await captureCodexExplicitState(paths);
  const compensation = await createCodexBackup(
    paths,
    sentinel?.managed_agents ?? [],
    new Set(),
    options.backupId,
    sentinel?.profile === "full",
  );
  await assertCodexSentinelUnchanged(paths, sentinel);
  await assertPreviousManagedContentUnmodified(paths, sentinel, true);
  await assertManagedPluginProvenance(paths, sentinel, await readCodexPluginState(paths));
  await assertCodexExplicitStateUnchanged(paths, explicitState);
  let operationExplicitState = explicitState;
  try {
    await removeCurrentManagedCodexState(paths, sentinel, async () => {
      operationExplicitState = await refreshOperationOwnedInstructions(
        paths,
        operationExplicitState,
      );
    });
    return basename(compensation);
  } catch (cause) {
    const explicitDrift = await captureCodexExplicitStateDrift(paths, operationExplicitState);
    return await restoreCodexAfterFailure(paths, compensation, cause, "uninstall", explicitDrift);
  }
}

export async function gatherCodexStatus(options: CodexStatusOptions = {}): Promise<CodexStatus> {
  const paths = codexInstallPaths(options.homeDir);
  const sentinel = await readSentinel(paths.sentinelPath);
  const packageJson = options.sourceDir
    ? await readJsonOrNull(join(resolve(options.sourceDir), "package.json"))
    : null;
  const rawPackagedVersion = isPlainObject(packageJson) ? packageJson.version : undefined;
  const packagedVersion =
    typeof rawPackagedVersion === "string" && STRICT_VERSION.test(rawPackagedVersion)
      ? rawPackagedVersion
      : null;
  const installedVersion = sentinel?.version ?? null;
  let versionWarning: string | null = null;
  if (options.sourceDir && installedVersion !== null) {
    if (STRICT_VERSION.test(installedVersion) && packagedVersion !== null) {
      const comparison = compareVersion(packagedVersion, installedVersion);
      if (comparison > 0) {
        versionWarning = `installed v${installedVersion} ≠ packaged v${packagedVersion} (re-run to update)`;
      } else if (comparison < 0) {
        versionWarning = `installed v${installedVersion} is newer than packaged v${packagedVersion}; this source checkout is older, so update or replace it before reinstalling`;
      }
    } else {
      versionWarning =
        "installed and packaged versions could not be compared; verify the source checkout and installed metadata before reinstalling";
    }
  }
  const instructions = await readFile(paths.globalInstructionsPath, "utf8").catch(() => "");
  const names = sentinel?.managed_agents ?? [];
  let nativeAgentCount = 0;
  for (const name of names) {
    if (existsSync(join(paths.agentsDir, `${name}.toml`))) nativeAgentCount++;
  }
  return {
    installedVersion,
    packagedVersion,
    versionWarning,
    installedProfile: sentinel?.profile ?? null,
    instructionBlockPresent:
      instructions.includes(INSTRUCTIONS_START) && instructions.includes(INSTRUCTIONS_END),
    pluginInstalled: await discoverPlugin(paths),
    nativeAgentCount,
    rulePresent: existsSync(join(paths.rulesDir, MANAGED_RULE_NAME)),
    sourcePresent: existsSync(paths.managedSource),
  };
}

export async function dryRunCodex(options: CodexDryRunOptions): Promise<string[]> {
  const paths = codexInstallPaths(options.homeDir);
  const agents = await preflightCodexSource(resolve(options.sourceDir));
  await assertCodexBoundaries(paths);
  await assertInstructionsMergeable(paths);
  if (options.profile === "full") {
    const previous = await readSentinel(paths.sentinelPath);
    await assertManagedAgentBoundaries(paths, [
      ...(previous?.managed_agents ?? []),
      ...agents.map((agent) => agent.name),
    ]);
    await assertNoNativeCollisions(
      paths,
      agents.map((agent) => agent.name),
      previous,
    );
  }
  const legacySkillWarning =
    options.profile === "full"
      ? formatLegacyCodexSkillOverlap(await scanLegacyCodexSkills(paths.homeDir))
      : null;
  return [
    ...(legacySkillWarning ? [legacySkillWarning] : []),
    `backup existing Codex-managed files to ${paths.backupsDir}`,
    `copy managed source to ${paths.managedSource}`,
    `merge the managed instruction block into ${paths.globalInstructionsPath}`,
    ...(options.profile === "full"
      ? [
          `install native role agents in ${paths.agentsDir}`,
          `install ${join(paths.rulesDir, MANAGED_RULE_NAME)}`,
          "install darkroom@cc-settings through the Codex plugin CLI",
        ]
      : ["skip Codex plugin, native role agents, and command rules (light profile)"]),
    `write ${paths.sentinelPath}`,
  ];
}
