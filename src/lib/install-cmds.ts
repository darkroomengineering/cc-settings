// Install command helpers — extracted from src/setup.ts (§1.1).
//
// One-shot commands that run before the main install logic:
//   printHelp — usage text
//   cmdRollback — restore a backup archive

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Settings } from "../schemas/settings.ts";
import { validateClaudeManagedFileOwnership } from "./claude-managed-files.ts";
import { error, info, success } from "./colors.ts";
import {
  CLAUDE_RUNTIME_MARKER,
  type ClaudeBackupSnapshot,
  claudeBackupScheduleSidecar,
  claudeBackupStateSidecar,
} from "./install-fs.ts";
import {
  BACKUP_ONLY_PATHS,
  MANAGED_TOP_LEVEL_PATHS,
  sharedDirOwnedFiles,
} from "./managed-paths.ts";
import { CLAUDE_DIR } from "./platform.ts";
import {
  parseAutoUpdateState,
  restoreAutoUpdateState,
  validateAutoUpdateStateSnapshot,
} from "./schedule.ts";
import { DestructiveSentinelSchema, readDestructiveSentinel } from "./version-delta.ts";

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

/** True when a `tar -tzf` listing entry is unsafe to extract: an absolute
 *  path, or a path containing a ".." segment (path traversal). Pure/exported
 *  for testing without spawning tar. */
export function isUnsafeTarEntry(entry: string): boolean {
  if (entry.startsWith("/") || isAbsolute(entry) || /^[A-Za-z]:[\\/]/.test(entry)) return true;
  return entry.split(/[\\/]+/).some((segment) => segment === "..");
}

/**
 * The distinct top-level managed paths (relative to the extract cwd) that an
 * archive will restore. Used to prune the current install to an EXACT restore:
 * `tar -xzf` overlays, so on its own it leaves files a newer release added that
 * the snapshot never had (e.g. a skill introduced after the backup). Pruning
 * these units first removes that drift.
 *
 * Granularity is one level below the extract root — `.claude/skills`, not
 * `.claude` — so regenerable/unmanaged siblings (backups/, tmp/, logs/)
 * are never touched. Installed src/ and ownership metadata are explicit
 * backup-only units. Only paths the archive actually contains are returned, so
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
 *  actually manages: settings.json + every managed or backup-only path, plus
 *  the home-relative ~/.claude.json. Rollback prunes ONLY these — never a path
 *  an arbitrary archive happens to contain (e.g. `.claude/backups`, which would
 *  delete the backups dir, including the archive being restored). */
function managedRestoreAllowset(homeRelative: boolean): Set<string> {
  const rels = [
    "settings.json",
    ...MANAGED_TOP_LEVEL_PATHS.map((e) => e.rel),
    ...BACKUP_ONLY_PATHS,
  ];
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

const STAGED_FILE_UNITS = new Set([
  "settings.json",
  ".claude.json",
  "CLAUDE.md",
  "AGENTS.md",
  "hooks-config.json",
  "hooks-config.local.json",
  ".cc-settings-version",
  ".cc-settings-hooks-fingerprint",
  ".cc-settings-src-manifest",
  ".cc-settings-baseline.json",
]);

function parseClaudeBackupState(serialized: string, archivePath: string): ClaudeBackupSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (cause) {
    throw new Error("Invalid Claude backup ownership-state metadata JSON", { cause });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid Claude backup ownership-state metadata");
  }
  const payload = parsed as Record<string, unknown>;
  if (
    (payload.version !== 2 && payload.version !== 3) ||
    !Array.isArray(payload.present) ||
    payload.present.some((path) => typeof path !== "string") ||
    !Array.isArray(payload.shared_owned_files_present) ||
    payload.shared_owned_files_present.some((path) => typeof path !== "string") ||
    (payload.managed_files_manifest_version !== null &&
      (!Number.isInteger(payload.managed_files_manifest_version) ||
        (payload.managed_files_manifest_version as number) <= 0)) ||
    (payload.restore_scope !== "exact" && payload.restore_scope !== "managed-absent") ||
    (payload.version === 3 &&
      payload.node_modules_target !== null &&
      (typeof payload.node_modules_target !== "string" ||
        !isAbsolute(payload.node_modules_target))) ||
    (payload.version === 3 &&
      (payload.managed_files === null ||
        typeof payload.managed_files !== "object" ||
        Array.isArray(payload.managed_files) ||
        Object.entries(payload.managed_files as Record<string, unknown>).some(
          ([path, hash]) =>
            isUnsafeTarEntry(path) || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash),
        )))
  ) {
    throw new Error("Invalid Claude backup ownership-state metadata");
  }
  const present = payload.present as string[];
  const sharedOwnedFilesPresent = payload.shared_owned_files_present as string[];
  const allowedUnits = managedRestoreAllowset(true);
  const allowedSharedFiles = new Set(
    MANAGED_TOP_LEVEL_PATHS.flatMap((entry) =>
      (sharedDirOwnedFiles(entry.rel) ?? []).map((file) => `.claude/${entry.rel}/${file}`),
    ),
  );
  if (
    new Set(present).size !== present.length ||
    new Set(sharedOwnedFilesPresent).size !== sharedOwnedFilesPresent.length ||
    present.some((path) => !allowedUnits.has(path)) ||
    sharedOwnedFilesPresent.some((path) => !allowedSharedFiles.has(path))
  ) {
    throw new Error("Unsafe Claude backup ownership-state metadata");
  }
  if (
    payload.restore_scope === "managed-absent" &&
    (payload.version !== 3 ||
      present.length !== 0 ||
      sharedOwnedFilesPresent.length !== 0 ||
      payload.managed_files_manifest_version !== null ||
      payload.node_modules_target !== null ||
      Object.keys(payload.managed_files as Record<string, string>).length !== 0)
  ) {
    throw new Error("Invalid managed-absent Claude backup ownership-state metadata");
  }
  for (const ownedPath of sharedOwnedFilesPresent) {
    const parent = ownedPath.slice(0, ownedPath.lastIndexOf("/"));
    if (!present.includes(parent)) {
      throw new Error("Inconsistent Claude backup shared-file ownership metadata");
    }
  }
  return {
    archivePath,
    present,
    sharedOwnedFilesPresent,
    managedFilesManifestVersion: payload.managed_files_manifest_version as number | null,
    restoreScope: payload.restore_scope,
    nodeModulesTarget:
      payload.version === 3 ? (payload.node_modules_target as string | null) : undefined,
    managedFiles:
      payload.version === 3 ? (payload.managed_files as Record<string, string>) : undefined,
  };
}

async function assertManagedAbsentArchiveEmpty(archivePath: string): Promise<void> {
  const listing = Bun.spawn(["tar", "-tzf", archivePath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(listing.stdout).text(),
    new Response(listing.stderr).text(),
    listing.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `Cannot validate managed-absent Claude backup archive: ${stderr.trim() || `tar exited ${code}`}`,
    );
  }
  const entries = stdout
    .split("\n")
    .map(normalizeArchiveEntry)
    .filter((entry) => entry && entry !== ".");
  if (entries.length !== 0) {
    throw new Error("Managed-absent Claude backup archive must contain zero entries");
  }
}

function archiveContainsUnit(entries: string[], unit: string): boolean {
  return entries.some((entry) => entry === unit || entry.startsWith(`${unit}/`));
}

function assertContained(root: string, candidate: string): void {
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`Refusing to restore path outside staging: ${candidate}`);
}

async function assertSafeStagedPath(staging: string, unit: string): Promise<void> {
  let current = staging;
  for (const segment of unit.split("/")) {
    current = join(current, segment);
    const metadata = await lstat(current).catch(() => null);
    if (!metadata || metadata.isSymbolicLink()) {
      throw new Error(`Missing or unsafe Claude backup payload: ${unit}`);
    }
  }
}

async function assertSafeStagedTree(
  path: string,
  label: string,
  managedNodeModulesTarget: string | null,
): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    const isManagedNodeModules = /^(?:\.claude\/)?src\/node_modules$/.test(label);
    if (!isManagedNodeModules || !managedNodeModulesTarget) {
      throw new Error(`Unsafe symlink in Claude backup: ${label}`);
    }
    const linkTarget = resolve(dirname(path), await readlink(path));
    const canonicalTarget = await realpath(linkTarget).catch(() => null);
    const targetMetadata = canonicalTarget ? await lstat(canonicalTarget).catch(() => null) : null;
    if (
      linkTarget !== managedNodeModulesTarget ||
      canonicalTarget !== managedNodeModulesTarget ||
      !targetMetadata?.isDirectory()
    ) {
      throw new Error(`Unsafe managed node_modules symlink in Claude backup: ${label}`);
    }
    return;
  }
  if (metadata.isFile()) return;
  if (!metadata.isDirectory()) throw new Error(`Unsupported entry in Claude backup: ${label}`);
  for (const entry of await readdir(path)) {
    await assertSafeStagedTree(join(path, entry), `${label}/${entry}`, managedNodeModulesTarget);
  }
}

async function parseStagedJson(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    throw new Error(`Invalid ${label} JSON in Claude backup`, { cause });
  }
}

interface CurrentClaudeOwnershipSnapshot {
  sentinelHash: string | null;
  managedFiles: Record<string, string>;
  nodeModulesTarget: string | null;
  explicitFileHashes: Record<string, string | null>;
}

interface StagedClaudeOwnership {
  managedFiles: Record<string, string>;
  nodeModulesTarget: string | null;
}

async function regularFileHash(path: string): Promise<string | null> {
  const metadata = await lstat(path).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  });
  if (!metadata) return null;
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Claude rollback expected a regular file: ${path}`);
  }
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function nodeModulesMatches(path: string, expectedTarget: string): Promise<boolean> {
  const metadata = await lstat(path).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  });
  if (!metadata) return false;
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    const marker = await readFile(join(path, ".cc-settings-owned.ts"), "utf8").catch(() => null);
    return (
      (await realpath(path).catch(() => null)) === expectedTarget &&
      marker === CLAUDE_RUNTIME_MARKER
    );
  }
  if (!metadata.isSymbolicLink()) return false;
  const linked = resolve(dirname(path), await readlink(path));
  if (linked === expectedTarget) return true;
  const [actual, expected] = await Promise.all([
    realpath(path).catch(() => null),
    realpath(expectedTarget).catch(() => null),
  ]);
  return actual !== null && actual === expected;
}

async function captureCurrentClaudeOwnership(): Promise<CurrentClaudeOwnershipSnapshot> {
  const sentinel = await readDestructiveSentinel(CLAUDE_DIR);
  const sentinelPath = join(CLAUDE_DIR, ".cc-settings-version");
  const sentinelHash = await regularFileHash(sentinelPath);
  const explicitFileHashes: Record<string, string | null> = {};
  for (const path of [join(CLAUDE_DIR, "settings.json"), join(homedir(), ".claude.json")]) {
    explicitFileHashes[path] = await regularFileHash(path);
  }
  if (!sentinel) {
    return { sentinelHash, managedFiles: {}, nodeModulesTarget: null, explicitFileHashes };
  }
  if (
    !sentinel.managed_files ||
    sentinel.managed_files_manifest_version === undefined ||
    (sentinel.profile !== "full" && sentinel.profile !== "light")
  ) {
    throw new Error(
      "Claude rollback requires current versioned managed_files ownership. " +
        "Reinstall cc-settings once before rolling back this legacy install.",
    );
  }
  await validateClaudeManagedFileOwnership(
    sentinel.managed_files,
    sentinel.repo_path ?? resolve(import.meta.dir, "../.."),
    sentinel.profile,
    CLAUDE_DIR,
    "exact",
    sentinel.managed_files_manifest_version,
  );
  const managedFiles = Object.fromEntries(
    Object.entries(sentinel.managed_files).map(([path, hash]) => [path, hash.toLowerCase()]),
  );
  for (const [relativePath, expectedHash] of Object.entries(sentinel.managed_files)) {
    const actualHash = await regularFileHash(join(CLAUDE_DIR, relativePath));
    if (actualHash !== expectedHash.toLowerCase()) {
      throw new Error(
        `Claude rollback would overwrite modified managed content: ${relativePath}. ` +
          "Restore the owned bytes or reinstall before rolling back.",
      );
    }
  }
  const installedNodeModules = join(CLAUDE_DIR, "src", "node_modules");
  const nodeModulesMetadata = await lstat(installedNodeModules).catch(() => null);
  let nodeModulesTarget: string | null = null;
  if (nodeModulesMetadata) {
    if (nodeModulesMetadata.isSymbolicLink() && sentinel.repo_path) {
      nodeModulesTarget = await realpath(resolve(sentinel.repo_path, "node_modules"));
    } else if (
      nodeModulesMetadata.isDirectory() &&
      !nodeModulesMetadata.isSymbolicLink() &&
      sentinel.managed_files_manifest_version
    ) {
      nodeModulesTarget = await realpath(installedNodeModules);
    }
    if (
      !nodeModulesTarget ||
      !(await nodeModulesMatches(installedNodeModules, nodeModulesTarget))
    ) {
      throw new Error("Claude rollback cannot prove src/node_modules ownership");
    }
  }
  return { sentinelHash, managedFiles, nodeModulesTarget, explicitFileHashes };
}

async function assertCurrentClaudeOwnershipMatches(
  snapshot: CurrentClaudeOwnershipSnapshot,
  targetManagedFiles: Record<string, string> = {},
): Promise<void> {
  if ((await regularFileHash(join(CLAUDE_DIR, ".cc-settings-version"))) !== snapshot.sentinelHash) {
    throw new Error("Claude ownership sentinel changed after rollback preparation");
  }
  for (const [path, expectedHash] of Object.entries(snapshot.explicitFileHashes)) {
    if ((await regularFileHash(path)) !== expectedHash) {
      throw new Error(`Claude rollback explicit state changed after preparation: ${path}`);
    }
  }
  for (const [relativePath, expectedHash] of Object.entries(snapshot.managedFiles)) {
    if ((await regularFileHash(join(CLAUDE_DIR, relativePath))) !== expectedHash) {
      throw new Error(`Claude managed file changed after rollback preparation: ${relativePath}`);
    }
  }
  const installedNodeModules = join(CLAUDE_DIR, "src", "node_modules");
  const nodeModulesMetadata = await lstat(installedNodeModules).catch(() => null);
  if (
    snapshot.nodeModulesTarget === null
      ? nodeModulesMetadata !== null
      : !(await nodeModulesMatches(installedNodeModules, snapshot.nodeModulesTarget))
  ) {
    throw new Error("Claude src/node_modules changed after rollback preparation");
  }
  for (const relativePath of Object.keys(targetManagedFiles)) {
    if (relativePath in snapshot.managedFiles) continue;
    const metadata = await lstat(join(CLAUDE_DIR, relativePath)).catch(() => null);
    if (metadata) {
      throw new Error(`Claude rollback target collides with unowned content: ${relativePath}`);
    }
  }
}

async function validateStagedRestore(
  staging: string,
  units: string[],
  homeRelative: boolean,
  requireManagedOwnership: boolean,
  expectedManifestVersion: number | null | undefined,
  expectedNodeModulesTarget: string | null | undefined,
  expectedManagedFiles: Record<string, string> | undefined,
): Promise<StagedClaudeOwnership | null> {
  let managedNodeModulesTarget: string | null = null;
  let stagedOwnership: StagedClaudeOwnership | null = null;
  const sentinelUnit = units.find((unit) =>
    homeRelative ? unit === ".claude/.cc-settings-version" : unit === ".cc-settings-version",
  );
  if (sentinelUnit) {
    const sentinelPath = join(staging, sentinelUnit);
    await assertSafeStagedPath(staging, sentinelUnit);
    const metadata = await lstat(sentinelPath);
    if (!metadata.isFile()) throw new Error("Invalid ownership sentinel in Claude backup");
    const parsed = await parseStagedJson(sentinelPath, "ownership sentinel");
    const result = DestructiveSentinelSchema.safeParse(parsed);
    if (!result.success) throw new Error("Invalid ownership sentinel in Claude backup");
    const managedRoot = homeRelative ? join(staging, ".claude") : staging;
    if (
      expectedManifestVersion !== undefined &&
      (result.data.managed_files_manifest_version ?? null) !== expectedManifestVersion
    ) {
      throw new Error("Claude backup sidecar does not match its ownership manifest version");
    }
    if (requireManagedOwnership) {
      if (result.data.profile !== "full" && result.data.profile !== "light") {
        throw new Error("Claude rollback ownership sentinel is missing a valid profile");
      }
      const sentinelManagedFiles = result.data.managed_files;
      const sidecarAuthority =
        !sentinelManagedFiles &&
        expectedManagedFiles !== undefined &&
        expectedManifestVersion === null;
      if (!sentinelManagedFiles && !sidecarAuthority) {
        throw new Error(
          "Claude rollback ownership sentinel is missing required managed_files hash ownership. " +
            "Reinstall cc-settings once to establish hash ownership before rolling back.",
        );
      }
      const managedFiles = sentinelManagedFiles ?? expectedManagedFiles ?? {};
      if (sentinelManagedFiles) {
        if (result.data.managed_files_manifest_version === undefined) {
          throw new Error(
            "Claude rollback ownership sentinel is missing managed_files_manifest_version. " +
              "Reinstall cc-settings once before rolling back this legacy backup.",
          );
        }
        await validateClaudeManagedFileOwnership(
          managedFiles,
          resolve(import.meta.dir, "../.."),
          result.data.profile,
          managedRoot,
          "exact",
          result.data.managed_files_manifest_version,
        );
      } else {
        if (result.data.managed_files_state === "managed-absent") {
          const allowedGenerated = new Set([
            ".cc-settings-hooks-fingerprint",
            ".cc-settings-src-manifest",
            ".cc-settings-baseline.json",
          ]);
          if (Object.keys(managedFiles).some((path) => !allowedGenerated.has(path))) {
            throw new Error("Managed-absent Claude backup claims non-generated file ownership");
          }
        } else if (
          !result.data.version ||
          !result.data.repo_path ||
          !isAbsolute(result.data.repo_path)
        ) {
          throw new Error("Legacy Claude rollback sidecar lacks a bounded historical owner");
        } else {
          const allowedLegacyRoots = new Set([
            "agents",
            "skills",
            "profiles",
            "rules",
            "hooks",
            "docs",
            "output-styles",
            "src",
            "contexts",
            "scripts",
            "lib",
          ]);
          const allowedLegacyFiles = new Set([
            "CLAUDE.md",
            "AGENTS.md",
            "hooks-config.json",
            "hooks-config.local.json",
            ".cc-settings-hooks-fingerprint",
            ".cc-settings-src-manifest",
            ".cc-settings-baseline.json",
          ]);
          for (const relativePath of Object.keys(managedFiles)) {
            const root = relativePath.split("/")[0] as string;
            if (!allowedLegacyFiles.has(relativePath) && !allowedLegacyRoots.has(root)) {
              throw new Error(`Unbounded historical Claude backup path: ${relativePath}`);
            }
          }
        }
      }
      for (const [relativePath, expectedHash] of Object.entries(managedFiles)) {
        const managedPath = join(managedRoot, relativePath);
        assertContained(managedRoot, managedPath);
        await assertSafeStagedPath(managedRoot, relativePath);
        const metadata = await lstat(managedPath);
        if (
          !metadata.isFile() ||
          createHash("sha256")
            .update(await readFile(managedPath))
            .digest("hex") !== expectedHash
        ) {
          throw new Error(
            `Claude rollback archive has inconsistent managed-file ownership: ${relativePath}. ` +
              "Reinstall cc-settings once before rolling back.",
          );
        }
      }
      stagedOwnership = {
        managedFiles: Object.fromEntries(
          Object.entries(managedFiles).map(([path, hash]) => [path, hash.toLowerCase()]),
        ),
        nodeModulesTarget: managedNodeModulesTarget,
      };
      if (
        expectedManagedFiles !== undefined &&
        JSON.stringify(Object.entries(stagedOwnership.managedFiles).sort()) !==
          JSON.stringify(Object.entries(expectedManagedFiles).sort())
      ) {
        throw new Error("Claude backup sidecar does not match its managed-file ownership hashes");
      }
    }
    const stagedNodeModules = join(managedRoot, "src", "node_modules");
    const stagedNodeModulesMetadata = await lstat(stagedNodeModules).catch(() => null);
    if (stagedNodeModulesMetadata?.isSymbolicLink()) {
      if (!result.data.repo_path || !isAbsolute(result.data.repo_path)) {
        throw new Error("Claude rollback cannot prove staged src/node_modules ownership");
      }
      managedNodeModulesTarget = await realpath(resolve(result.data.repo_path, "node_modules"));
    } else if (stagedNodeModulesMetadata?.isDirectory()) {
      const managedRuntimeTarget = join(await realpath(CLAUDE_DIR), "src", "node_modules");
      const marker = await readFile(join(stagedNodeModules, ".cc-settings-owned.ts"), "utf8").catch(
        () => null,
      );
      if (expectedNodeModulesTarget !== managedRuntimeTarget || marker !== CLAUDE_RUNTIME_MARKER) {
        throw new Error("Claude backup sidecar does not own its managed runtime directory");
      }
      managedNodeModulesTarget = managedRuntimeTarget;
    }
    if (
      expectedNodeModulesTarget !== undefined &&
      managedNodeModulesTarget !== expectedNodeModulesTarget
    ) {
      throw new Error("Claude backup sidecar does not match its node_modules ownership target");
    }
  }
  if (expectedNodeModulesTarget === null) managedNodeModulesTarget = null;
  if (!requireManagedOwnership && expectedManagedFiles !== undefined) {
    const managedRoot = homeRelative ? join(staging, ".claude") : staging;
    for (const [relativePath, expectedHash] of Object.entries(expectedManagedFiles)) {
      const managedPath = join(managedRoot, relativePath);
      assertContained(managedRoot, managedPath);
      await assertSafeStagedPath(managedRoot, relativePath);
      const metadata = await lstat(managedPath).catch(() => null);
      if (
        !metadata?.isFile() ||
        metadata.isSymbolicLink() ||
        createHash("sha256")
          .update(await readFile(managedPath))
          .digest("hex") !== expectedHash
      ) {
        throw new Error(`Claude compensation payload hash mismatch: ${relativePath}`);
      }
    }
    stagedOwnership = {
      managedFiles: Object.fromEntries(
        Object.entries(expectedManagedFiles).map(([path, hash]) => [path, hash.toLowerCase()]),
      ),
      nodeModulesTarget: managedNodeModulesTarget,
    };
  }
  for (const unit of units) {
    const path = join(staging, unit);
    assertContained(staging, path);
    await assertSafeStagedPath(staging, unit);
    const rel = homeRelative ? unit.replace(/^\.claude\//, "") : unit;
    const expectedFile = STAGED_FILE_UNITS.has(rel) || unit === ".claude.json";
    const metadata = await lstat(path).catch(() => null);
    if (!metadata || metadata.isSymbolicLink()) {
      throw new Error(`Missing or unsafe Claude backup payload: ${unit}`);
    }
    if (expectedFile ? !metadata.isFile() : !metadata.isDirectory()) {
      throw new Error(`Wrong Claude backup payload type: ${unit}`);
    }
    if (metadata.isDirectory()) await assertSafeStagedTree(path, unit, managedNodeModulesTarget);

    if (rel === "settings.json") {
      const parsed = await parseStagedJson(path, "settings.json");
      const result = Settings.safeParse(parsed);
      if (!result.success) throw new Error("Invalid settings.json in Claude backup");
    } else if (unit === ".claude.json") {
      const parsed = await parseStagedJson(path, ".claude.json");
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Invalid .claude.json in Claude backup");
      }
    }
  }
  if (stagedOwnership) stagedOwnership.nodeModulesTarget = managedNodeModulesTarget;
  return stagedOwnership;
}

interface PrepareArchiveOptions {
  requireOwnershipState: boolean;
  exactSnapshot?: ClaudeBackupSnapshot;
  announce: boolean;
  currentOwnership?: CurrentClaudeOwnershipSnapshot;
  managedScope?: readonly string[];
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
