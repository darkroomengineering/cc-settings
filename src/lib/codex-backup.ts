import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, sep } from "node:path";
import {
  assertCodexBoundaries,
  assertManagedAgentBoundaries,
  type BackupManifest,
  type BackupPluginState,
  backupRelativePath,
  type CodexExplicitStateDrift,
  type CodexInstallPaths,
  type CodexPluginState,
  type CodexSentinel,
  codexCliAvailable,
  codexInstallPaths,
  contentHash,
  copyIfPresent,
  errorDetail,
  isCodexCliSkippedForTests,
  MANAGED_RULE_NAME,
  MAX_BACKUPS,
  readSentinel,
  regularFileHash,
  removeFileWithHash,
  restoreCodexExplicitStateDrift,
  SHA256,
  SHARED_BACKUP_ID,
  toPluginState,
  validatedAgentNames,
} from "./codex-install-state.ts";
import {
  assertBoundedAgentNames,
  assertSentinelAgentOwnership,
  managedBlockRange,
  removeAgentFiles,
  removeInstructions,
  shippedNativeAgentNames,
} from "./codex-native-agents.ts";
import {
  assertManagedPluginProvenance,
  canonicalManagedSourcePath,
  isManagedPluginSource,
  readCodexPluginState,
  removePlugin,
  restorePluginState,
} from "./codex-plugin.ts";
import {
  assertPreviousManagedContentUnmodified,
  copyRuntimeManifest,
  installPreparedManagedSource,
  prepareManagedSource,
  runtimeManifestHashes,
} from "./codex-runtime.ts";
import { RUNTIME_SOURCE_FILES, runtimePathsForVersion } from "./codex-runtime-manifests.ts";
import { isPlainObject } from "./merge-keyed.ts";
import { getTimestamp } from "./platform.ts";

export async function createCodexBackup(
  paths: CodexInstallPaths,
  nextManagedAgents: string[],
  preservedBackups: ReadonlySet<string> = new Set(),
  backupId?: string,
  pluginMutationPlanned = false,
  emptySnapshot = false,
): Promise<string> {
  const previous = await readSentinel(paths.sentinelPath);
  assertSentinelAgentOwnership(previous, await shippedNativeAgentNames(), paths.sentinelPath);
  if (emptySnapshot && previous) {
    throw new Error("Cannot create an empty Codex snapshot for an installed managed profile");
  }
  const observedPluginState = emptySnapshot ? null : await readCodexPluginState(paths);
  await assertManagedPluginProvenance(paths, previous, observedPluginState);
  const fallbackPluginState: CodexPluginState | null = isCodexCliSkippedForTests()
    ? {
        pluginInstalled: false,
        pluginEnabled: false,
        marketplaceEnrolled: false,
        pluginSource: null,
        marketplaceSource: null,
      }
    : null;
  const capturedPluginState =
    observedPluginState ?? (previous?.profile === "full" ? fallbackPluginState : null);
  const pluginState: BackupPluginState | null = capturedPluginState
    ? {
        ...capturedPluginState,
        restoreMode:
          previous?.profile === "full" ? "managed-restorable" : "independent-preserve-only",
      }
    : null;
  if (pluginMutationPlanned && pluginState?.pluginInstalled && !pluginState.pluginEnabled) {
    throw new Error(
      "The installed darkroom Codex plugin is disabled, and this Codex CLI has no supported command to restore that state exactly. Re-enable or remove it before continuing.",
    );
  }
  const now = new Date();
  if (backupId !== undefined && !SHARED_BACKUP_ID.test(backupId)) {
    throw new Error(`Invalid shared backup identifier: ${backupId}`);
  }
  let name = backupId ?? `${getTimestamp(now)}-${String(now.getMilliseconds()).padStart(3, "0")}`;
  let backup = join(paths.backupsDir, name);
  let suffix = 1;
  while (existsSync(backup)) {
    if (backupId) throw new Error(`Shared Codex backup already exists: ${backupId}`);
    name = `${getTimestamp(now)}-${String(now.getMilliseconds()).padStart(3, "0")}-${suffix++}`;
    backup = join(paths.backupsDir, name);
  }
  await mkdir(backup, { recursive: true });

  try {
    const previousManagedAgents = previous?.managed_agents ?? [];
    const candidates = emptySnapshot
      ? []
      : [
          paths.managedSource,
          paths.sentinelPath,
          paths.globalInstructionsPath,
          paths.configPath,
          ...(previous?.profile === "full" ? [join(paths.rulesDir, MANAGED_RULE_NAME)] : []),
          ...new Set([...previousManagedAgents, ...nextManagedAgents])
            .values()
            .map((name) => join(paths.agentsDir, `${name}.toml`)),
        ];
    const present: string[] = [];
    for (const source of candidates) {
      const rel = backupRelativePath(source, paths);
      assertSafeBackupRelativePath(rel, backup);
      const sourceMetadata = await lstat(source).catch(() => null);
      if (!sourceMetadata) continue;
      if (sourceMetadata.isSymbolicLink()) {
        throw new Error(`Unsafe symlink in live Codex backup source: ${rel}`);
      }
      const expectsDirectory = source === paths.managedSource;
      if (expectsDirectory ? !sourceMetadata.isDirectory() : !sourceMetadata.isFile()) {
        throw new Error(`Wrong live Codex backup source type: ${rel}`);
      }
      if (expectsDirectory) {
        const artifacts = previous
          ? runtimePathsForVersion(previous.runtime_manifest_version, paths.sentinelPath)
          : RUNTIME_SOURCE_FILES;
        await copyRuntimeManifest(source, join(backup, "files", rel), artifacts);
        present.push(rel);
      } else if (await copyIfPresent(source, join(backup, "files", rel))) {
        present.push(rel);
      }
    }
    const manifest: BackupManifest = {
      createdAt: now.toISOString(),
      restoreScope: emptySnapshot ? "managed-absent" : "exact",
      present,
      previousManagedAgents,
      nextManagedAgents,
      pluginState,
      restoredProfile: previous?.profile ?? null,
      runtimeManifestVersion: previous?.runtime_manifest_version ?? null,
      payloadHashes: Object.fromEntries(
        await Promise.all(
          present
            .filter(
              (relativePath) => relativePath !== backupRelativePath(paths.managedSource, paths),
            )
            .map(async (relativePath) => [
              relativePath,
              await regularFileHash(join(backup, "files", relativePath)),
            ]),
        ),
      ) as Record<string, string>,
    };
    await writeFile(join(backup, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await readBackupManifest(backup, paths);
  } catch (cause) {
    await rm(backup, { recursive: true, force: true }).catch(() => {});
    throw cause;
  }

  const backups = (await readdir(paths.backupsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const stale of backups.slice(MAX_BACKUPS)) {
    const stalePath = join(paths.backupsDir, stale);
    if (!preservedBackups.has(stalePath)) {
      await rm(stalePath, { recursive: true, force: true });
    }
  }
  return backup;
}

export async function restorePluginStateAndConfig(
  paths: CodexInstallPaths,
  backup: string,
  present: Set<string>,
  state: BackupPluginState | null,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await restorePluginState(paths, state);
  } catch (cause) {
    errors.push(cause);
  }
  try {
    await restoreBackupPath(
      backup,
      backupRelativePath(paths.configPath, paths),
      paths.configPath,
      present,
    );
  } catch (cause) {
    errors.push(cause);
  }
  if (state !== null && !isCodexCliSkippedForTests()) {
    try {
      const restoredState = await readCodexPluginState(paths);
      const expectedState = toPluginState(state);
      if (JSON.stringify(restoredState) !== JSON.stringify(expectedState)) {
        throw new Error("Restored Codex plugin state does not match its backup manifest");
      }
    } catch (cause) {
      errors.push(cause);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `Codex plugin/config state restoration failed:\n${errors.map(errorDetail).join("\n")}`,
    );
  }
}

export async function readBackupManifest(
  backup: string,
  paths: CodexInstallPaths,
): Promise<BackupManifest> {
  const manifestPath = join(backup, "manifest.json");
  const manifestMetadata = await lstat(manifestPath);
  if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()) {
    throw new Error(`Invalid Codex backup manifest file: ${backup}`);
  }
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!isPlainObject(parsed)) throw new Error(`Invalid Codex backup manifest: ${backup}`);
  const createdAt = parsed.createdAt;
  if (typeof createdAt !== "string") throw new Error(`Invalid Codex backup manifest: ${backup}`);
  const restoreScope = parsed.restoreScope;
  if (restoreScope !== "exact" && restoreScope !== "managed-absent") {
    throw new Error(`Invalid Codex backup restore scope: ${backup}`);
  }
  if (!Array.isArray(parsed.present) || parsed.present.some((entry) => typeof entry !== "string")) {
    throw new Error(`Invalid Codex backup manifest paths: ${backup}`);
  }
  const present = parsed.present as string[];
  const pluginState = parseBackupPluginState(parsed.pluginState, backup);
  const runtimeManifestVersion = parsed.runtimeManifestVersion;
  if (runtimeManifestVersion !== null) {
    runtimePathsForVersion(runtimeManifestVersion, backup);
  }
  if (!isPlainObject(parsed.payloadHashes)) {
    throw new Error(`Invalid Codex backup payload hashes: ${backup}`);
  }
  const payloadHashes: Record<string, string> = {};
  for (const [path, hash] of Object.entries(parsed.payloadHashes)) {
    if (typeof hash !== "string" || !SHA256.test(hash)) {
      throw new Error(`Invalid Codex backup payload hash: ${path}`);
    }
    payloadHashes[path] = hash;
  }
  const allowedAgentNames = await shippedNativeAgentNames();
  const previousManagedAgents = validatedAgentNames(parsed.previousManagedAgents, backup);
  const nextManagedAgents = validatedAgentNames(parsed.nextManagedAgents, backup);
  assertBoundedAgentNames(previousManagedAgents, allowedAgentNames, backup);
  assertBoundedAgentNames(nextManagedAgents, allowedAgentNames, backup);
  const managedSourceRel = backupRelativePath(paths.managedSource, paths);
  const allowedPresent = new Set([
    managedSourceRel,
    backupRelativePath(paths.sentinelPath, paths),
    backupRelativePath(paths.globalInstructionsPath, paths),
    backupRelativePath(paths.configPath, paths),
    backupRelativePath(join(paths.rulesDir, MANAGED_RULE_NAME), paths),
    ...new Set([...previousManagedAgents, ...nextManagedAgents])
      .values()
      .map((name) => join("agents", `${name}.toml`)),
  ]);
  if (
    new Set(present).size !== present.length ||
    present.some((path) => !allowedPresent.has(path))
  ) {
    throw new Error(`Unbounded or duplicate Codex backup manifest paths: ${backup}`);
  }
  for (const path of present) {
    assertSafeBackupRelativePath(path, backup);
    await assertBackupPayload(backup, path, path === managedSourceRel ? "directory" : "file");
  }
  const sentinelRel = backupRelativePath(paths.sentinelPath, paths);
  let backedUpSentinel: CodexSentinel | null = null;
  if (present.includes(sentinelRel)) {
    const backedUpSentinelPath = join(backup, "files", sentinelRel);
    backedUpSentinel = await readSentinel(backedUpSentinelPath);
    assertSentinelAgentOwnership(backedUpSentinel, allowedAgentNames, backedUpSentinelPath);
  }
  if (
    (backedUpSentinel === null) !== !present.includes(sentinelRel) ||
    JSON.stringify([...previousManagedAgents].sort()) !==
      JSON.stringify([...(backedUpSentinel?.managed_agents ?? [])].sort())
  ) {
    throw new Error(`Codex backup ownership does not match its sentinel: ${backup}`);
  }
  if ((backedUpSentinel?.runtime_manifest_version ?? null) !== runtimeManifestVersion) {
    throw new Error(`Codex backup runtime manifest version is inconsistent: ${backup}`);
  }
  if (
    backedUpSentinel?.profile === "full" &&
    (pluginState === null || pluginState.restoreMode !== "managed-restorable")
  ) {
    throw new Error(`Full Codex backup is missing observed plugin state: ${backup}`);
  }
  if (
    restoreScope === "managed-absent" &&
    (present.length !== 0 ||
      previousManagedAgents.length !== 0 ||
      nextManagedAgents.length !== 0 ||
      pluginState !== null ||
      backedUpSentinel !== null ||
      runtimeManifestVersion !== null ||
      Object.keys(payloadHashes).length !== 0)
  ) {
    throw new Error(`Invalid managed-absent Codex backup scope: ${backup}`);
  }
  await assertBackupManifestConsistency(
    backup,
    paths,
    present,
    backedUpSentinel,
    pluginState,
    managedSourceRel,
    payloadHashes,
  );
  return {
    createdAt,
    restoreScope,
    present,
    previousManagedAgents,
    nextManagedAgents,
    pluginState,
    restoredProfile: backedUpSentinel?.profile ?? null,
    payloadHashes,
    runtimeManifestVersion: runtimeManifestVersion as number | null,
  };
}

async function assertBackupManifestConsistency(
  backup: string,
  paths: CodexInstallPaths,
  present: string[],
  sentinel: CodexSentinel | null,
  pluginState: BackupPluginState | null,
  managedSourceRel: string,
  payloadHashes: Record<string, string>,
): Promise<void> {
  const filesRoot = join(backup, "files");
  const actual = new Set<string>();
  const visit = async (directory: string, prefix = ""): Promise<void> => {
    for (const entry of await readdir(directory)) {
      const rel = prefix ? join(prefix, entry) : entry;
      const path = join(directory, entry);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw new Error(`Unsafe Codex backup payload: ${rel}`);
      if (rel === managedSourceRel) {
        if (!metadata.isDirectory()) throw new Error(`Invalid managed source backup: ${backup}`);
        actual.add(rel);
      } else if (metadata.isDirectory()) {
        await visit(path, rel);
      } else if (metadata.isFile()) {
        actual.add(rel);
      } else {
        throw new Error(`Unsupported Codex backup payload: ${rel}`);
      }
    }
  };
  const rootMetadata = await lstat(filesRoot).catch(() => null);
  if (rootMetadata) {
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      throw new Error(`Invalid Codex backup files root: ${backup}`);
    }
    await visit(filesRoot);
  }
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...present].sort())) {
    throw new Error(`Codex backup manifest does not match its payloads: ${backup}`);
  }
  const expectedHashPaths = present.filter((path) => path !== managedSourceRel).sort();
  if (JSON.stringify(Object.keys(payloadHashes).sort()) !== JSON.stringify(expectedHashPaths)) {
    throw new Error(`Codex backup payload hash coverage is incomplete: ${backup}`);
  }
  for (const path of expectedHashPaths) {
    if ((await regularFileHash(join(filesRoot, path))) !== payloadHashes[path]) {
      throw new Error(`Codex backup payload hash mismatch: ${path}`);
    }
  }

  const ruleRel = backupRelativePath(join(paths.rulesDir, MANAGED_RULE_NAME), paths);
  const instructionsRel = backupRelativePath(paths.globalInstructionsPath, paths);
  if (!sentinel) {
    if (present.includes(managedSourceRel) || present.includes(ruleRel)) {
      throw new Error(`Codex backup contains managed state without a sentinel: ${backup}`);
    }
    if (present.includes(instructionsRel)) {
      const text = await readFile(join(filesRoot, instructionsRel), "utf8");
      if (managedBlockRange(text)) {
        throw new Error(`Codex backup contains a managed instructions block without a sentinel`);
      }
    }
    return;
  }

  if (!present.includes(managedSourceRel) || !present.includes(instructionsRel)) {
    throw new Error(`Codex backup omits required managed source or instructions: ${backup}`);
  }
  const runtimePaths = runtimePathsForVersion(sentinel.runtime_manifest_version, backup);
  await assertRuntimeBackupDirectory(
    join(filesRoot, managedSourceRel),
    managedSourceRel,
    runtimePaths,
  );
  const sourceHashes = await runtimeManifestHashes(join(filesRoot, managedSourceRel), runtimePaths);
  if (JSON.stringify(sourceHashes) !== JSON.stringify(sentinel.managed_source_hashes)) {
    throw new Error(`Codex backup source hashes do not match its sentinel: ${backup}`);
  }
  const instructions = await readFile(join(filesRoot, instructionsRel), "utf8");
  const range = managedBlockRange(instructions);
  if (
    !range ||
    contentHash(instructions.slice(range.start, range.end)) !== sentinel.managed_instructions_hash
  ) {
    throw new Error(`Codex backup instructions do not match its sentinel: ${backup}`);
  }
  for (const name of sentinel.managed_agents) {
    const rel = join("agents", `${name}.toml`);
    if (
      !present.includes(rel) ||
      (await regularFileHash(join(filesRoot, rel))) !== sentinel.managed_agent_hashes?.[name]
    ) {
      throw new Error(`Codex backup agent ownership is inconsistent: ${name}`);
    }
  }
  if (sentinel.profile === "full") {
    if (
      !present.includes(ruleRel) ||
      (await regularFileHash(join(filesRoot, ruleRel))) !== sentinel.managed_rule_hash
    ) {
      throw new Error(`Codex backup rule ownership is inconsistent: ${backup}`);
    }
    if (pluginState?.restoreMode === "managed-restorable") {
      const expected = await canonicalManagedSourcePath(paths);
      if (
        (pluginState.marketplaceEnrolled && pluginState.marketplaceSource !== expected) ||
        (pluginState.pluginInstalled &&
          !(await isManagedPluginSource(paths, expected, pluginState.pluginSource)))
      ) {
        throw new Error(`Codex backup plugin provenance is inconsistent: ${backup}`);
      }
    }
  } else if (present.includes(ruleRel)) {
    throw new Error(`Light Codex backup contains a managed rule: ${backup}`);
  }
}

function parseBackupPluginState(value: unknown, backup: string): BackupPluginState | null {
  if (value === null) return null;
  if (
    !isPlainObject(value) ||
    typeof value.pluginInstalled !== "boolean" ||
    typeof value.pluginEnabled !== "boolean" ||
    typeof value.marketplaceEnrolled !== "boolean" ||
    (value.pluginSource !== null && typeof value.pluginSource !== "string") ||
    (value.marketplaceSource !== null && typeof value.marketplaceSource !== "string") ||
    (value.pluginEnabled && !value.pluginInstalled) ||
    (!value.pluginInstalled && value.pluginSource !== null) ||
    (!value.marketplaceEnrolled && value.marketplaceSource !== null) ||
    (value.pluginInstalled && (value.pluginSource === null || value.marketplaceSource === null)) ||
    (value.marketplaceEnrolled && value.marketplaceSource === null) ||
    (value.restoreMode !== undefined &&
      value.restoreMode !== "managed-restorable" &&
      value.restoreMode !== "independent-preserve-only") ||
    (typeof value.pluginSource === "string" && !isAbsolute(value.pluginSource)) ||
    (typeof value.marketplaceSource === "string" && !isAbsolute(value.marketplaceSource))
  ) {
    throw new Error(`Invalid or legacy Codex plugin state in backup: ${backup}`);
  }
  return {
    pluginInstalled: value.pluginInstalled,
    pluginEnabled: value.pluginEnabled,
    marketplaceEnrolled: value.marketplaceEnrolled,
    pluginSource: value.pluginSource,
    marketplaceSource: value.marketplaceSource,
    restoreMode:
      value.restoreMode === "independent-preserve-only"
        ? "independent-preserve-only"
        : "managed-restorable",
  };
}

/** List valid shared-operation Codex backups without selecting or mutating one. */
export async function listCodexSharedBackupIds(
  options: { homeDir?: string } = {},
): Promise<string[]> {
  const paths = codexInstallPaths(options.homeDir);
  await assertCodexBoundaries(paths);
  const backupDirMetadata = await lstat(paths.backupsDir).catch(() => null);
  if (!backupDirMetadata) return [];
  if (!backupDirMetadata.isDirectory() || backupDirMetadata.isSymbolicLink()) {
    throw new Error(`Unsafe Codex backups directory: ${paths.backupsDir}`);
  }

  const ids: string[] = [];
  for (const entry of await readdir(paths.backupsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SHARED_BACKUP_ID.test(entry.name)) continue;
    const backup = join(paths.backupsDir, entry.name);
    const metadata = await lstat(backup).catch(() => null);
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) continue;
    try {
      await readBackupManifest(backup, paths);
      ids.push(entry.name);
    } catch {
      // A malformed backup cannot participate in an exact paired rollback.
    }
  }
  return ids.sort().reverse();
}

function assertSafeBackupRelativePath(path: string, source: string): void {
  if (
    !path ||
    isAbsolute(path) ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.split(/[\\/]+/).includes("..")
  ) {
    throw new Error(`Unsafe path in Codex backup manifest ${source}: ${path}`);
  }
}

async function assertBackupPayload(
  backup: string,
  relativePath: string,
  expected: "file" | "directory",
): Promise<void> {
  let current = join(backup, "files");
  const parts = relativePath.split(sep);
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index] as string);
    const metadata = await lstat(current).catch(() => null);
    if (!metadata || metadata.isSymbolicLink()) {
      throw new Error(`Missing or unsafe Codex backup payload: ${relativePath}`);
    }
    const isLast = index === parts.length - 1;
    if (!isLast && !metadata.isDirectory()) {
      throw new Error(`Invalid Codex backup payload path: ${relativePath}`);
    }
    if (isLast) {
      const valid = expected === "file" ? metadata.isFile() : metadata.isDirectory();
      if (!valid) throw new Error(`Wrong Codex backup payload type: ${relativePath}`);
      if (expected === "directory") await assertSafeBackupDirectory(current, relativePath);
    }
  }
}

async function assertSafeBackupDirectory(directory: string, relativePath: string): Promise<void> {
  for (const entry of await readdir(directory)) {
    const child = join(directory, entry);
    const metadata = await lstat(child);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Unsafe symlink in Codex backup payload: ${relativePath}`);
    }
    if (metadata.isDirectory()) {
      await assertSafeBackupDirectory(child, relativePath);
    } else if (!metadata.isFile()) {
      throw new Error(`Unsupported entry in Codex backup payload: ${relativePath}`);
    }
  }
}

async function assertRuntimeBackupDirectory(
  directory: string,
  relativePath: string,
  artifacts: readonly string[],
): Promise<void> {
  const allowedFiles = new Set<string>(artifacts);
  const allowedDirectories = new Set<string>();
  for (const file of allowedFiles) {
    const segments = file.split("/");
    for (let index = 1; index < segments.length; index++) {
      allowedDirectories.add(segments.slice(0, index).join("/"));
    }
  }
  const visit = async (current: string, rel = ""): Promise<void> => {
    for (const entry of await readdir(current)) {
      const childRel = rel ? `${rel}/${entry}` : entry;
      const child = join(current, entry);
      const metadata = await lstat(child);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Unsafe symlink in Codex backup payload: ${relativePath}/${childRel}`);
      }
      if (metadata.isDirectory()) {
        if (!allowedDirectories.has(childRel)) {
          throw new Error(`Unmanaged Codex runtime directory in backup: ${childRel}`);
        }
        await visit(child, childRel);
      } else if (!metadata.isFile() || !allowedFiles.has(childRel)) {
        throw new Error(`Unmanaged Codex runtime file in backup: ${childRel}`);
      }
    }
  };
  await visit(directory);
}

export async function resolveBackup(
  paths: CodexInstallPaths,
  target: string | true,
): Promise<string> {
  if (!existsSync(paths.backupsDir)) throw new Error("No Codex backups found");
  const entries = (await readdir(paths.backupsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const selected =
    target === true
      ? entries[0]
      : SHARED_BACKUP_ID.test(target)
        ? entries.find((entry) => entry === target)
        : entries.find((entry) => entry.includes(target));
  if (!selected || selected.includes("..") || selected.includes(sep)) {
    throw new Error(
      target === true ? "No Codex backups found" : `No Codex backup matches ${target}`,
    );
  }
  return join(paths.backupsDir, selected);
}

export async function restoreBackupPath(
  backup: string,
  rel: string,
  destination: string,
  present: Set<string>,
): Promise<void> {
  await rm(destination, { recursive: true, force: true });
  if (present.has(rel)) await copyIfPresent(join(backup, "files", rel), destination);
}

export async function prepareManagedSourceFromBackup(
  paths: CodexInstallPaths,
  backup: string,
  present: Set<string>,
  runtimeManifestVersion: number | null,
): Promise<string | null> {
  const relativePath = backupRelativePath(paths.managedSource, paths);
  if (!present.has(relativePath)) return null;
  const artifacts = runtimePathsForVersion(runtimeManifestVersion, backup);
  return await prepareManagedSource(join(backup, "files", relativePath), paths, artifacts);
}

export async function restoreCodexBackupExact(
  paths: CodexInstallPaths,
  backup: string,
): Promise<void> {
  const manifest = await readBackupManifest(backup, paths);
  if (manifest.restoreScope === "managed-absent") {
    const current = await readSentinel(paths.sentinelPath);
    assertSentinelAgentOwnership(current, await shippedNativeAgentNames(), paths.sentinelPath);
    if (current) await removeCurrentManagedCodexState(paths, current);
    return;
  }
  await assertManagedAgentBoundaries(paths, [
    ...manifest.previousManagedAgents,
    ...manifest.nextManagedAgents,
  ]);
  const present = new Set(manifest.present);
  const preparedSource = await prepareManagedSourceFromBackup(
    paths,
    backup,
    present,
    manifest.runtimeManifestVersion,
  );
  const pluginErrors: unknown[] = [];
  try {
    if (manifest.pluginState?.restoreMode === "managed-restorable") {
      try {
        await removePlugin(paths, true);
      } catch (cause) {
        pluginErrors.push(cause);
      }
    }
    for (const name of new Set([
      ...manifest.previousManagedAgents,
      ...manifest.nextManagedAgents,
    ])) {
      await rm(join(paths.agentsDir, `${name}.toml`), { force: true });
    }
    for (const name of manifest.previousManagedAgents) {
      const rel = join("agents", `${name}.toml`);
      if (present.has(rel)) {
        await copyIfPresent(join(backup, "files", rel), join(paths.codexHome, rel));
      }
    }
    for (const destination of [
      join(paths.rulesDir, MANAGED_RULE_NAME),
      paths.sentinelPath,
      paths.globalInstructionsPath,
    ]) {
      await restoreBackupPath(backup, backupRelativePath(destination, paths), destination, present);
    }
    await installPreparedManagedSource(paths, preparedSource);
    try {
      await restorePluginStateAndConfig(paths, backup, present, manifest.pluginState);
    } catch (cause) {
      pluginErrors.push(cause);
    }
    if (pluginErrors.length > 0) {
      throw new AggregateError(
        pluginErrors,
        `Codex files were restored, but plugin state restoration failed:\n${pluginErrors
          .map(errorDetail)
          .join("\n")}`,
      );
    }
  } finally {
    if (preparedSource) {
      await rm(preparedSource, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function restoreCodexAfterFailure(
  paths: CodexInstallPaths,
  backup: string,
  cause: unknown,
  operation: string,
  explicitDrift: CodexExplicitStateDrift = {},
): Promise<never> {
  const restoreFailures: unknown[] = [];
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
      `Codex ${operation} failed and backup restoration was incomplete: ${backup}\n` +
        `Operation failure: ${errorDetail(cause)}\n` +
        `Restore failure: ${restoreFailures.map(errorDetail).join("; ")}`,
    );
  }
  throw cause;
}

export function exactCompensationBackup(paths: CodexInstallPaths, backupName: string): string {
  if (
    !backupName ||
    basename(backupName) !== backupName ||
    backupName.includes("/") ||
    backupName.includes("\\")
  ) {
    throw new Error(`Invalid Codex compensation backup identifier: ${backupName}`);
  }
  const backup = join(paths.backupsDir, backupName);
  if (!existsSync(backup)) throw new Error(`Codex compensation backup not found: ${backupName}`);
  return backup;
}

export async function removeCurrentManagedCodexState(
  paths: CodexInstallPaths,
  sentinel: CodexSentinel,
  explicitStateChanged?: () => Promise<void>,
): Promise<void> {
  await assertPreviousManagedContentUnmodified(paths, sentinel, true);
  const pluginState = await readCodexPluginState(paths);
  await assertManagedPluginProvenance(paths, sentinel, pluginState);
  if (sentinel.profile === "full" && !isCodexCliSkippedForTests() && !codexCliAvailable()) {
    throw new Error("Codex CLI is required to remove managed plugin or marketplace state");
  }
  await assertManagedAgentBoundaries(paths, sentinel.managed_agents);
  if (sentinel.profile === "full") {
    await removePlugin(paths, true);
  }
  await removeAgentFiles(paths, sentinel.managed_agents, sentinel.managed_agent_hashes);
  if (sentinel.profile === "full") {
    await removeFileWithHash(join(paths.rulesDir, MANAGED_RULE_NAME), sentinel.managed_rule_hash);
  }
  await rm(paths.sentinelPath, { force: true });
  await rm(paths.managedSource, { recursive: true, force: true });
  await rmdir(dirname(paths.managedSource)).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code !== "ENOENT" && cause.code !== "ENOTEMPTY") throw cause;
  });
  if (existsSync(paths.globalInstructionsPath)) {
    const existing = await readFile(paths.globalInstructionsPath, "utf8");
    const updated = removeInstructions(existing);
    if (updated.length === 0) await rm(paths.globalInstructionsPath, { force: true });
    else await writeFile(paths.globalInstructionsPath, updated);
    await explicitStateChanged?.();
  }
}
