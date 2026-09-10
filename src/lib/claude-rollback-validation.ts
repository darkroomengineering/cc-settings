import { lstat, readdir, readFile, readlink, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Settings } from "../schemas/settings.ts";
import { validateClaudeManagedFileOwnership } from "./claude-managed-files.ts";
import { CLAUDE_RUNTIME_MARKER, type ClaudeBackupSnapshot } from "./install-fs.ts";
import {
  BACKUP_ONLY_PATHS,
  MANAGED_TOP_LEVEL_PATHS,
  sharedDirOwnedFiles,
} from "./managed-paths.ts";
import { CLAUDE_DIR, sha256 } from "./platform.ts";
import { DestructiveSentinelSchema, readDestructiveSentinel } from "./version-delta.ts";

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
export function normalizeArchiveEntry(raw: string): string {
  let entry = raw.trim();
  while (entry.startsWith("./")) entry = entry.slice(2);
  return entry;
}

/** The set of restore units (relative to the extract cwd) that cc-settings
 *  actually manages: settings.json + every managed or backup-only path, plus
 *  the home-relative ~/.claude.json. Rollback prunes ONLY these — never a path
 *  an arbitrary archive happens to contain (e.g. `.claude/backups`, which would
 *  delete the backups dir, including the archive being restored). */
export function managedRestoreAllowset(homeRelative: boolean): Set<string> {
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

export function parseClaudeBackupState(
  serialized: string,
  archivePath: string,
): ClaudeBackupSnapshot {
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

export async function assertManagedAbsentArchiveEmpty(archivePath: string): Promise<void> {
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

export function archiveContainsUnit(entries: string[], unit: string): boolean {
  return entries.some((entry) => entry === unit || entry.startsWith(`${unit}/`));
}

export function assertContained(root: string, candidate: string): void {
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`Refusing to restore path outside staging: ${candidate}`);
}

export async function assertSafeStagedPath(staging: string, unit: string): Promise<void> {
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

export interface CurrentClaudeOwnershipSnapshot {
  sentinelHash: string | null;
  managedFiles: Record<string, string>;
  nodeModulesTarget: string | null;
  explicitFileHashes: Record<string, string | null>;
}

export interface StagedClaudeOwnership {
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
  return sha256(await readFile(path));
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

export async function captureCurrentClaudeOwnership(): Promise<CurrentClaudeOwnershipSnapshot> {
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

export async function assertCurrentClaudeOwnershipMatches(
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

export async function validateStagedRestore(
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
        if (!metadata.isFile() || sha256(await readFile(managedPath)) !== expectedHash) {
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
        sha256(await readFile(managedPath)) !== expectedHash
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
