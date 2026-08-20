// Fs-mutation install phases — everything that actually touches disk during
// an install: backup, directory scaffolding, stale-config cleanup, and the
// copy phases (config files + the ~/.claude/src TS tree).
//
// These depend only on sourceDir/profile/CLAUDE_DIR-style inputs, never on
// Args, CLI dispatch, or settings-merge — src/setup.ts owns orchestration
// (phase order, dependency install, settings write) and calls into here for
// the disk work.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { currentClaudeManagedSourceFiles } from "./claude-managed-file-manifests.ts";
import { validateClaudeManagedFileOwnership } from "./claude-managed-files.ts";
import { error } from "./colors.ts";
import type { Profile } from "./light-profile.ts";
import { MANAGED_TOP_LEVEL_PATHS, sharedDirOwnedFiles } from "./managed-paths.ts";
import { CLAUDE_DIR, getTimestamp } from "./platform.ts";
import { serializeAutoUpdateState, snapshotAutoUpdateState } from "./schedule.ts";
import { readDestructiveSentinel } from "./version-delta.ts";

// --- Install phases ------------------------------------------------------

/**
 * Fail-closed guard run BEFORE any destructive step (createBackup /
 * cleanOldConfig). Verifies sourceDir is a complete cc-settings checkout for
 * the target profile.
 *
 * Without this, a bad `--source` (a partial checkout, a wrong path, an
 * interrupted clone) is a data-loss bug: cleanOldConfig() rm -rf's the managed
 * footprint first, then the copy phase silently skips every missing source
 * leaving the user with a wiped install and nothing copied back. Aborting here
 * — while the existing install is still intact — is the only safe order.
 *
 * Throws listing every missing path; callers MUST NOT proceed past a throw.
 * composeSettings (config/ fragment validity) is validated separately by the
 * orchestrator, also pre-clean.
 */
function assertSelectedSourceFile(sourceDir: string, relativePath: string): void {
  const root = resolve(sourceDir);
  const rootMetadata = lstatSync(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error("source root is not a real directory");
  }
  const segments = relativePath.split("/");
  let current = root;
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index] as string);
    const metadata = lstatSync(current);
    const leaf = index === segments.length - 1;
    if (metadata.isSymbolicLink()) throw new Error("symbolic link");
    if (leaf ? !metadata.isFile() : !metadata.isDirectory()) {
      throw new Error(leaf ? "not a regular file" : "ancestor is not a directory");
    }
  }
}

export function preflightInstallSource(sourceDir: string, profile: Profile): void {
  const required = [
    ...currentClaudeManagedSourceFiles(profile).map(({ source }) => source),
    "config/10-core.json",
    "config/20-mcp.json",
    "config/30-permissions.json",
    "config/40-hooks.json",
  ];
  const problems: string[] = [];
  for (const relativePath of new Set(required)) {
    try {
      assertSelectedSourceFile(sourceDir, relativePath);
    } catch (cause) {
      const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : "";
      problems.push(`${relativePath}${detail}`);
    }
  }
  try {
    const dependencies = lstatSync(join(resolve(sourceDir), "node_modules"));
    if (dependencies.isSymbolicLink() || !dependencies.isDirectory()) {
      problems.push("node_modules: not a real directory");
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    if (!(process.env.NODE_ENV === "test" && process.env.CC_SKIP_DEPS === "1")) {
      problems.push("node_modules: missing runtime dependencies");
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `--source is not a complete cc-settings checkout (${sourceDir}). ` +
        `Missing, unsafe, or wrong type: ${problems.sort().join(", ")}. Refusing to install — the ` +
        "destructive clean phase would wipe your working install and then have nothing to copy.",
    );
  }
}

export interface ClaudeBackupSnapshot {
  archivePath: string | null;
  present: string[];
  sharedOwnedFilesPresent: string[];
  managedFilesManifestVersion?: number | null;
  restoreScope?: "exact" | "managed-absent";
  nodeModulesTarget?: string | null;
  managedFiles?: Record<string, string>;
}

const SHARED_BACKUP_ID = /^\d{14}-\d{3}-\d+-\d+$/;

export function claudeBackupScheduleSidecar(archivePath: string): string {
  return `${archivePath}.schedule.json`;
}

export function claudeBackupStateSidecar(archivePath: string): string {
  return `${archivePath}.state.json`;
}

function serializeClaudeBackupState(snapshot: ClaudeBackupSnapshot): string {
  return `${JSON.stringify(
    {
      version: 3,
      present: snapshot.present,
      shared_owned_files_present: snapshot.sharedOwnedFilesPresent,
      managed_files_manifest_version: snapshot.managedFilesManifestVersion ?? null,
      restore_scope: snapshot.restoreScope ?? "exact",
      node_modules_target: snapshot.nodeModulesTarget ?? null,
      managed_files: snapshot.managedFiles ?? {},
    },
    null,
    2,
  )}\n`;
}

async function createBackup(
  options: {
    temporary?: boolean;
    preserveBackupName?: string;
    backupId?: string;
    managedAbsent?: boolean;
    managedFiles?: Record<string, string>;
  } = {},
): Promise<ClaudeBackupSnapshot> {
  const backupDir = join(CLAUDE_DIR, options.temporary ? "tmp" : "backups");
  await mkdir(backupDir, { recursive: true });
  let preserveBackupName: string | null = null;
  if (options.preserveBackupName !== undefined) {
    const name = options.preserveBackupName;
    if (
      options.temporary ||
      basename(name) !== name ||
      !/^backup-.*\.tar\.gz$/.test(name) ||
      !(await lstat(join(backupDir, name)).catch(() => null))?.isFile()
    ) {
      throw new Error(`Invalid Claude backup retention exemption: ${name}`);
    }
    preserveBackupName = name;
  }
  if (options.backupId !== undefined && !SHARED_BACKUP_ID.test(options.backupId)) {
    throw new Error(`Invalid shared backup identifier: ${options.backupId}`);
  }

  const home = homedir();
  // Home-relative paths so the archive can include ~/.claude.json — it holds the
  // MCP server config that installMcpToClaudeJson rewrites and lives alongside
  // ~/.claude, not inside it. Without it, --rollback could not restore a user's
  // MCP setup. cmdRollback detects this layout (".claude/"-prefixed entries) and
  // extracts from $HOME; older ~/.claude-relative archives still restore correctly.
  //
  const sentinel = await readDestructiveSentinel(CLAUDE_DIR);
  if (options.managedAbsent && sentinel !== null) {
    throw new Error("Cannot create a managed-absent Claude backup while a sentinel exists");
  }
  if (sentinel?.managed_files && options.managedFiles === undefined) {
    if (
      (sentinel.profile !== "full" && sentinel.profile !== "light") ||
      sentinel.managed_files_manifest_version === undefined
    ) {
      throw new Error("Cannot back up Claude state without complete versioned ownership metadata");
    }
    await validateClaudeManagedFileOwnership(
      sentinel.managed_files,
      sentinel.repo_path ?? resolve(import.meta.dir, "../.."),
      sentinel.profile,
      CLAUDE_DIR,
      "exact",
      sentinel.managed_files_manifest_version,
    );
  }
  const backupManagedFiles = options.managedAbsent
    ? {}
    : Object.fromEntries(
        Object.entries(options.managedFiles ?? sentinel?.managed_files ?? {}).map(
          ([path, hash]) => [path, hash.toLowerCase()],
        ),
      );
  for (const [relativePath, expectedHash] of Object.entries(backupManagedFiles)) {
    const path = join(CLAUDE_DIR, relativePath);
    const metadata = await lstat(path).catch(() => null);
    if (
      !metadata?.isFile() ||
      metadata.isSymbolicLink() ||
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex") !== expectedHash
    ) {
      throw new Error(`Cannot back up changed Claude managed file: ${relativePath}`);
    }
  }
  const managedPaths = Object.keys(backupManagedFiles).map((path) => `.claude/${path}`);
  let nodeModulesTarget: string | null = null;
  const installedNodeModules = join(CLAUDE_DIR, "src", "node_modules");
  const installedNodeModulesMetadata = options.managedAbsent
    ? null
    : await lstat(installedNodeModules).catch((cause) => {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw cause;
      });
  if (installedNodeModulesMetadata) {
    if (!sentinel?.repo_path || !installedNodeModulesMetadata.isSymbolicLink()) {
      throw new Error("Cannot back up unowned Claude src/node_modules");
    }
    const expected = await realpath(resolve(sentinel.repo_path, "node_modules"));
    const linked = await realpath(installedNodeModules).catch(() => null);
    if (linked !== expected) {
      throw new Error("Cannot back up repointed Claude src/node_modules");
    }
    nodeModulesTarget = expected;
    managedPaths.push(".claude/src/node_modules");
  }
  const archivePaths = options.managedAbsent
    ? []
    : [
        ".claude/settings.json",
        ".claude/.cc-settings-version",
        ...managedPaths,
        ".claude.json",
      ].filter(
        (path, index, paths) => paths.indexOf(path) === index && existsSync(join(home, path)),
      );
  const present = [
    ...new Set(
      archivePaths.map((path) => {
        if (path === ".claude.json") return path;
        const relativePath = path.slice(".claude/".length);
        const topLevel = relativePath.split("/")[0] as string;
        return `.claude/${topLevel}`;
      }),
    ),
  ];
  const sharedOwnedFilesPresent = MANAGED_TOP_LEVEL_PATHS.flatMap((entry) =>
    (sharedDirOwnedFiles(entry.rel) ?? [])
      .map((file) => `.claude/${entry.rel}/${file}`)
      .filter((file) => archivePaths.includes(file)),
  );
  const managedFilesManifestVersion = sentinel?.managed_files_manifest_version ?? null;
  if (archivePaths.length === 0 && (options.temporary || options.backupId === undefined)) {
    return {
      archivePath: null,
      present: [],
      sharedOwnedFilesPresent,
      managedFilesManifestVersion,
      restoreScope: options.managedAbsent ? "managed-absent" : "exact",
      nodeModulesTarget,
      managedFiles: backupManagedFiles,
    };
  }

  const stamp = getTimestamp();
  const prefix = options.temporary ? "compensation" : "backup";
  let archive = join(backupDir, `${prefix}-${options.backupId ?? stamp}.tar.gz`);
  let suffix = 1;
  while (
    existsSync(archive) ||
    existsSync(claudeBackupScheduleSidecar(archive)) ||
    existsSync(claudeBackupStateSidecar(archive))
  ) {
    if (options.backupId)
      throw new Error(`Shared Claude backup already exists: ${options.backupId}`);
    archive = join(backupDir, `${prefix}-${stamp}z${String(suffix++).padStart(3, "0")}.tar.gz`);
  }
  const emptyListPath =
    archivePaths.length === 0 ? join(backupDir, `.empty-${randomUUID()}.files`) : null;
  if (emptyListPath) await writeFile(emptyListPath, "", { flag: "wx", mode: 0o600 });
  const tarCommand =
    archivePaths.length > 0
      ? ["tar", "-czf", archive, ...archivePaths]
      : ["tar", "-czf", archive, "--files-from", emptyListPath as string];
  let stderrText: string;
  let code: number;
  try {
    const proc = Bun.spawn(tarCommand, {
      cwd: home,
      stdout: "ignore",
      stderr: "pipe",
    });
    [stderrText, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  } finally {
    if (emptyListPath) await rm(emptyListPath, { force: true });
  }
  if (code !== 0) {
    // A silent backup failure would let the install proceed into cleanOldConfig
    // (which rm -rf's managed dirs) with no restore point — the advertised
    // --rollback safety net would be quietly disabled. Abort instead.
    error(`Backup failed (tar exited ${code}): ${stderrText.trim()}`);
    error("Aborting so --rollback stays possible. Fix the tar error above and re-run.");
    throw new Error(`backup failed — tar exited ${code}`);
  }

  if (options.temporary) {
    return {
      archivePath: archive,
      present,
      sharedOwnedFilesPresent,
      managedFilesManifestVersion,
      restoreScope: options.managedAbsent ? "managed-absent" : "exact",
      nodeModulesTarget,
      managedFiles: backupManagedFiles,
    };
  }

  const sidecar = claudeBackupScheduleSidecar(archive);
  const stateSidecar = claudeBackupStateSidecar(archive);
  const snapshot: ClaudeBackupSnapshot = {
    archivePath: archive,
    present,
    sharedOwnedFilesPresent,
    managedFilesManifestVersion,
    restoreScope: options.managedAbsent ? "managed-absent" : "exact",
    nodeModulesTarget,
    managedFiles: backupManagedFiles,
  };
  try {
    await Promise.all([
      writeFile(sidecar, serializeAutoUpdateState(await snapshotAutoUpdateState()), {
        flag: "wx",
        mode: 0o600,
      }),
      writeFile(stateSidecar, serializeClaudeBackupState(snapshot), {
        flag: "wx",
        mode: 0o600,
      }),
    ]);
  } catch (cause) {
    await Promise.all([
      rm(archive, { force: true }).catch(() => {}),
      rm(sidecar, { force: true }).catch(() => {}),
      rm(stateSidecar, { force: true }).catch(() => {}),
    ]);
    throw cause;
  }

  // Keep last 5.
  const kept = (await readdir(backupDir)).filter((e) => /^backup-.*\.tar\.gz$/.test(e)).sort();
  if (kept.length > 5) {
    const stale = kept.filter((name) => name !== preserveBackupName).slice(0, kept.length - 5);
    await Promise.all(
      stale.flatMap((old) => [
        rm(join(backupDir, old), { force: true }).catch(() => {}),
        rm(claudeBackupScheduleSidecar(join(backupDir, old)), { force: true }).catch(() => {}),
        rm(claudeBackupStateSidecar(join(backupDir, old)), { force: true }).catch(() => {}),
      ]),
    );
  }
  return snapshot;
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

async function copySelectedSourceFile(
  sourceRoot: string,
  sourceRelativePath: string,
  destination: string,
): Promise<void> {
  assertSelectedSourceFile(sourceRoot, sourceRelativePath);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(sourceRoot, sourceRelativePath), destination, { recursive: false, force: true });
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
  const files = currentClaudeManagedSourceFiles(profile).filter(
    ({ destination }) => !destination.startsWith("src/"),
  );
  await Promise.all(
    files.map(({ source: sourcePath, destination }) =>
      copySelectedSourceFile(source, sourcePath, join(CLAUDE_DIR, destination)),
    ),
  );
}

async function installTsSources(source: string): Promise<void> {
  const dstTs = join(CLAUDE_DIR, "src");
  const runtimeFiles = currentClaudeManagedSourceFiles("light").filter(({ destination }) =>
    destination.startsWith("src/"),
  );
  for (const { source: sourcePath } of runtimeFiles) {
    assertSelectedSourceFile(source, sourcePath);
  }
  await mkdir(dstTs, { recursive: true });
  await Promise.all(
    runtimeFiles.map(({ source: sourcePath, destination }) =>
      copySelectedSourceFile(source, sourcePath, join(CLAUDE_DIR, destination)),
    ),
  );

  const srcNm = join(source, "node_modules");
  const dstNm = join(dstTs, "node_modules");
  const existingDestination = await lstat(dstNm).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  });
  if (existingDestination) {
    throw new Error("Claude managed destination collision: src/node_modules");
  }
  const sourceDependencies = await lstat(srcNm).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  });
  if (!sourceDependencies) {
    if (process.env.CC_SKIP_DEPS === "1") return;
    throw new Error(`Claude runtime dependencies are missing: ${srcNm}`);
  }
  if (!sourceDependencies.isDirectory() || sourceDependencies.isSymbolicLink()) {
    throw new Error(`Claude runtime dependencies are not a real directory: ${srcNm}`);
  }
  await symlink(srcNm, dstNm, process.platform === "win32" ? "junction" : "dir");
  const [sourceTarget, installedTarget] = await Promise.all([realpath(srcNm), realpath(dstNm)]);
  if (sourceTarget !== installedTarget) {
    throw new Error("Claude runtime dependency link does not resolve to the source dependencies");
  }
}

export { createBackup, createDirectories, installConfigFiles, installTsSources };
