import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { currentClaudeManagedSourceFiles } from "./claude-managed-file-manifests.ts";
import {
  CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION,
  validateClaudeManagedFileOwnership,
} from "./claude-managed-files.ts";
import type { EngineDescriptor } from "./code-intel-engine.ts";
import { ClaudePrewriteOwnershipChangedError } from "./install-cmds.ts";
import { CLAUDE_RUNTIME_MARKER } from "./install-fs.ts";
import type { Profile } from "./light-profile.ts";
import { CLAUDE_JSON_PATH, type McpServers } from "./mcp.ts";
import { CLAUDE_DIR, sha256 } from "./platform.ts";
import { plistPath } from "./schedule.ts";
import { readDestructiveSentinel, type Sentinel, writeSentinel } from "./version-delta.ts";

export function claudeManagedPath(relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes("..")) {
    throw new Error(`Unsafe managed file path in Claude sentinel: ${relativePath}`);
  }
  const destination = resolve(CLAUDE_DIR, relativePath);
  const fromRoot = relative(CLAUDE_DIR, destination);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Managed file path escapes Claude home: ${relativePath}`);
  }
  return destination;
}

export async function regularFileHash(path: string): Promise<string | null> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile()) return null;
    return sha256(await readFile(path));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

async function profileFileMappings(
  sourceDir: string,
  profile: Profile,
): Promise<Array<readonly [source: string, destination: string]>> {
  return currentClaudeManagedSourceFiles(profile).map(({ source, destination }) => [
    join(sourceDir, source),
    destination,
  ]);
}

interface PreparedClaudeInstallOwnership {
  files: Record<string, string>;
  nodeModulesTarget: string | null;
  targetPaths: string[];
  snapshot: ClaudeLifecycleOwnershipSnapshot;
}

interface ClaudeLifecycleFileState {
  present: boolean;
  hash: string | null;
}

export interface ClaudeLifecycleOwnershipSnapshot {
  managedFiles: Record<string, string>;
  relativeFiles: Record<string, ClaudeLifecycleFileState>;
  sentinel: ClaudeLifecycleFileState;
  nodeModulesPresent: boolean;
  nodeModulesTarget: string | null;
}

interface ClaudeSharedFileState {
  present: boolean;
  hash: string | null;
  bytes?: Uint8Array;
  mode?: number;
}

export interface ClaudeSharedExplicitSnapshot {
  settings: ClaudeSharedFileState;
  global: ClaudeSharedFileState;
}

export interface ClaudeSharedExplicitDrift {
  settings?: ClaudeSharedFileState;
  global?: ClaudeSharedFileState;
}

export type ClaudeMutationPhase = "unstarted" | "files" | "scheduler";

async function captureClaudeSharedFileState(path: string): Promise<ClaudeSharedFileState> {
  const metadata = await lstat(path).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  });
  if (!metadata) return { present: false, hash: null };
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Claude shared state is not a regular file: ${path}`);
  }
  const bytes = await readFile(path);
  return {
    present: true,
    hash: sha256(bytes),
    bytes,
    mode: metadata.mode & 0o777,
  };
}

export async function captureClaudeSharedExplicitState(): Promise<ClaudeSharedExplicitSnapshot> {
  const [settings, global] = await Promise.all([
    captureClaudeSharedFileState(join(CLAUDE_DIR, "settings.json")),
    captureClaudeSharedFileState(CLAUDE_JSON_PATH),
  ]);
  return { settings, global };
}

function claudeSharedFileStateMatches(
  left: ClaudeSharedFileState,
  right: ClaudeSharedFileState,
): boolean {
  return left.present === right.present && left.hash === right.hash;
}

function isSafeClaudeSharedDrift(state: ClaudeSharedFileState): boolean {
  if (!state.present) return true;
  if (!state.bytes) return false;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(state.bytes).toString("utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

export async function captureClaudeSharedExplicitDrift(
  before: ClaudeSharedExplicitSnapshot,
): Promise<ClaudeSharedExplicitDrift> {
  const after = await captureClaudeSharedExplicitState();
  return {
    ...(!claudeSharedFileStateMatches(after.settings, before.settings) &&
    isSafeClaudeSharedDrift(after.settings)
      ? { settings: after.settings }
      : {}),
    ...(!claudeSharedFileStateMatches(after.global, before.global) &&
    isSafeClaudeSharedDrift(after.global)
      ? { global: after.global }
      : {}),
  };
}

export async function captureClaudeSharedExplicitDriftAfterFailure(
  before: ClaudeSharedExplicitSnapshot,
): Promise<ClaudeSharedExplicitDrift> {
  try {
    return await captureClaudeSharedExplicitDrift(before);
  } catch {
    // Wrong-type or unreadable failure output is not valid external JSON drift.
    // Exact compensation restores it from the pre-operation snapshot instead.
    return {};
  }
}

export async function restoreClaudeSharedExplicitDrift(
  drift: ClaudeSharedExplicitDrift,
): Promise<void> {
  for (const [path, state] of [
    [join(CLAUDE_DIR, "settings.json"), drift.settings],
    [CLAUDE_JSON_PATH, drift.global],
  ] as const) {
    if (!state) continue;
    await rm(path, { recursive: true, force: true });
    if (!state.present || state.bytes === undefined || state.mode === undefined) continue;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, state.bytes);
    await chmod(path, state.mode);
  }
}

async function captureClaudeLifecycleFileState(path: string): Promise<ClaudeLifecycleFileState> {
  const metadata = await lstat(path).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  });
  if (!metadata) return { present: false, hash: null };
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Claude lifecycle expected a regular file: ${path}`);
  }
  return {
    present: true,
    hash: sha256(await readFile(path)),
  };
}

export async function captureClaudeLifecycleOwnership(
  managedFiles: Record<string, string>,
  targetPaths: readonly string[],
  nodeModulesTarget: string | null,
): Promise<ClaudeLifecycleOwnershipSnapshot> {
  const relativeFiles: Record<string, ClaudeLifecycleFileState> = {};
  for (const relativePath of new Set([...Object.keys(managedFiles), ...targetPaths])) {
    const state = await captureClaudeLifecycleFileState(claudeManagedPath(relativePath));
    const expectedHash = managedFiles[relativePath]?.toLowerCase();
    if (expectedHash && (!state.present || state.hash !== expectedHash)) {
      throw new Error(
        `Claude managed file is missing or modified: ${relativePath}. ` +
          "Restore the owned bytes or reinstall before continuing.",
      );
    }
    relativeFiles[relativePath] = state;
  }
  const sentinel = await captureClaudeLifecycleFileState(join(CLAUDE_DIR, ".cc-settings-version"));
  const installedNodeModules = claudeManagedPath(join("src", "node_modules"));
  const nodeModulesMetadata = await lstat(installedNodeModules).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  });
  if (
    nodeModulesMetadata &&
    (!nodeModulesTarget ||
      !(await claudeNodeModulesMatches(installedNodeModules, nodeModulesTarget)))
  ) {
    throw new Error("Claude src/node_modules ownership changed during lifecycle preparation");
  }
  return {
    managedFiles: Object.fromEntries(
      Object.entries(managedFiles).map(([path, hash]) => [path, hash.toLowerCase()]),
    ),
    relativeFiles,
    sentinel,
    nodeModulesPresent: nodeModulesMetadata !== null,
    nodeModulesTarget,
  };
}

export async function assertClaudeLifecycleOwnershipUnchanged(
  snapshot: ClaudeLifecycleOwnershipSnapshot,
): Promise<void> {
  try {
    for (const [relativePath, expected] of Object.entries(snapshot.relativeFiles)) {
      const current = await captureClaudeLifecycleFileState(claudeManagedPath(relativePath));
      if (JSON.stringify(current) !== JSON.stringify(expected)) {
        throw new Error(`Claude managed file changed after preparation: ${relativePath}`);
      }
    }
    const installedNodeModules = claudeManagedPath(join("src", "node_modules"));
    const metadata = await lstat(installedNodeModules).catch((cause) => {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    });
    const matches =
      snapshot.nodeModulesPresent === (metadata !== null) &&
      (!snapshot.nodeModulesPresent ||
        (snapshot.nodeModulesTarget !== null &&
          (await claudeNodeModulesMatches(installedNodeModules, snapshot.nodeModulesTarget))));
    if (!matches) throw new Error("Claude src/node_modules changed after preparation");
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ClaudePrewriteOwnershipChangedError(detail, cause);
  }
  const currentSentinel = await captureClaudeLifecycleFileState(
    join(CLAUDE_DIR, ".cc-settings-version"),
  );
  if (JSON.stringify(currentSentinel) !== JSON.stringify(snapshot.sentinel)) {
    throw new Error("Claude ownership sentinel changed after lifecycle preparation");
  }
}

async function claudeNodeModulesMatches(path: string, expectedTarget: string): Promise<boolean> {
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
  const linkedTarget = resolve(dirname(path), await readlink(path));
  if (linkedTarget === expectedTarget) return true;
  try {
    const [actual, expected] = await Promise.all([realpath(path), realpath(expectedTarget)]);
    return actual === expected;
  } catch {
    return false;
  }
}

export async function validateClaudeNodeModulesOwnership(
  sentinel: Awaited<ReturnType<typeof readDestructiveSentinel>>,
): Promise<string | null> {
  const installedPath = claudeManagedPath(join("src", "node_modules"));
  const metadata = await lstat(installedPath).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  });
  if (!metadata) return null;
  let expectedTarget: string | null = null;
  if (metadata.isSymbolicLink() && sentinel?.repo_path) {
    expectedTarget = await realpath(resolve(sentinel.repo_path, "node_modules"));
  } else if (
    metadata.isDirectory() &&
    !metadata.isSymbolicLink() &&
    sentinel?.managed_files &&
    sentinel.managed_files_manifest_version
  ) {
    expectedTarget = await realpath(installedPath);
  }
  if (!expectedTarget || !(await claudeNodeModulesMatches(installedPath, expectedTarget))) {
    throw new Error(
      "Claude managed destination collision: src/node_modules. " +
        "Preserve or remove the unowned path before installing.",
    );
  }
  return expectedTarget;
}

export async function validateClaudeInstallBoundaries(): Promise<void> {
  const allowedSystemAliases = new Map([
    [resolve("/var"), resolve("/private/var")],
    [resolve("/tmp"), resolve("/private/tmp")],
  ]);
  const assertBoundary = async (
    candidate: string,
    leafKind: "file" | "directory",
  ): Promise<void> => {
    const absolute = resolve(candidate);
    const root = parse(absolute).root;
    let current = root;
    const segments = absolute.slice(root.length).split(sep).filter(Boolean);
    for (let index = 0; index < segments.length; index++) {
      current = join(current, segments[index] as string);
      const metadata = await lstat(current).catch((cause) => {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw cause;
      });
      if (!metadata) return;
      const leaf = index === segments.length - 1;
      if (metadata.isSymbolicLink()) {
        const allowedTarget = allowedSystemAliases.get(current);
        if (!allowedTarget || (await realpath(current).catch(() => null)) !== allowedTarget) {
          throw new Error(`Unsafe Claude install boundary symlink: ${current}`);
        }
        continue;
      }
      if (!leaf || leafKind === "directory") {
        if (!metadata.isDirectory()) {
          throw new Error(`Claude install boundary is not a directory: ${current}`);
        }
      } else if (!metadata.isFile()) {
        throw new Error(`Claude install boundary is not a regular file: ${current}`);
      }
    }
  };

  const sentinel = await readDestructiveSentinel(CLAUDE_DIR);
  const managedFiles = Object.keys(sentinel?.managed_files ?? {});
  const fileDestinations = new Set([
    ...currentClaudeManagedSourceFiles("full").map(({ destination }) => destination),
    ...managedFiles,
    "settings.json",
    ".cc-settings-version",
  ]);
  await assertBoundary(CLAUDE_DIR, "directory");
  await Promise.all([
    ...[
      "agents",
      "skills",
      "rules",
      "profiles",
      "docs",
      "hooks",
      "output-styles",
      "src",
      "backups",
      "tmp",
    ].map((path) => assertBoundary(join(CLAUDE_DIR, path), "directory")),
    ...[...fileDestinations].map((path) => assertBoundary(claudeManagedPath(path), "file")),
    assertBoundary(join(CLAUDE_DIR, "tmp", "install.lock"), "file"),
    assertBoundary(join(homedir(), ".claude.json"), "file"),
    assertBoundary(plistPath(homedir()), "file"),
  ]);
}

async function gitOutput(sourceDir: string, args: string[]): Promise<Buffer> {
  const child = Bun.spawn(["git", "-C", sourceDir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `Cannot inspect historical Claude ownership: ${stderr.trim() || args.join(" ")}`,
    );
  }
  return Buffer.from(stdout);
}

async function historicalClaudeOwnership(
  sourceDir: string,
  profile: Profile,
  version: string | undefined,
): Promise<Record<string, string>> {
  if (!version) {
    throw new Error(
      "Legacy Claude ownership has no installed version. Reinstall from the matching historical cc-settings checkout before upgrading.",
    );
  }
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const commits = (
    await gitOutput(sourceDir, [
      "log",
      "--format=%H",
      `-G"version"[[:space:]]*:[[:space:]]*"${escapedVersion}"`,
      "--",
      "package.json",
    ])
  )
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  // -G matches diff lines in both directions, so a superseded version always
  // hits two commits: the one that introduced it and the release that removed
  // it. Keep only commits whose package.json actually carries the version.
  const carriers: string[] = [];
  for (const candidate of commits) {
    try {
      const manifest = JSON.parse(
        (await gitOutput(sourceDir, ["show", `${candidate}:package.json`])).toString("utf8"),
      ) as { version?: unknown };
      if (manifest.version === version) carriers.push(candidate);
    } catch {
      // Unreadable or unparsable historical manifest: not a trusted carrier.
    }
  }
  if (carriers.length !== 1) {
    throw new Error(
      `Legacy Claude ownership version ${version} does not resolve to exactly one trusted source commit. ` +
        "Use that version's checkout to reinstall once before upgrading.",
    );
  }
  const commit = carriers[0] as string;
  const selected =
    profile === "full"
      ? [
          "CLAUDE-FULL.md",
          "AGENTS.md",
          "agents",
          "skills",
          "profiles",
          "rules",
          "hooks",
          "docs",
          "output-styles",
          "src",
          "package.json",
          "tsconfig.json",
          "bun.lock",
        ]
      : ["skills/share-learning", "src", "package.json", "tsconfig.json", "bun.lock"];
  const listing = (await gitOutput(sourceDir, ["ls-tree", "-r", commit, "--", ...selected]))
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  const sourceFiles: string[] = [];
  for (const line of listing) {
    const match = /^(100644|100755) blob [a-f0-9]+\t(.+)$/.exec(line);
    if (!match) throw new Error(`Unsafe historical Claude source entry: ${line}`);
    const path = match[2] as string;
    if (path.includes("/.tldr/") || path.endsWith("/.tldrignore")) continue;
    if (["src/package.json", "src/tsconfig.json", "src/bun.lock"].includes(path)) continue;
    sourceFiles.push(path);
  }
  const sourceToDestination = (path: string): string => {
    if (path === "CLAUDE-FULL.md") return "CLAUDE.md";
    if (path === "package.json") return "src/package.json";
    if (path === "tsconfig.json") return "src/tsconfig.json";
    if (path === "bun.lock") return "src/bun.lock";
    return path;
  };
  const ownership: Record<string, string> = {};
  for (const sourcePath of sourceFiles) {
    const destination = sourceToDestination(sourcePath);
    const expected = sha256(await gitOutput(sourceDir, ["show", `${commit}:${sourcePath}`]));
    if ((await regularFileHash(claudeManagedPath(destination))) !== expected) {
      throw new Error(
        `Historical Claude managed file is missing, unsafe, or modified: ${destination}. ` +
          "Restore the exact installed version before migrating.",
      );
    }
    ownership[destination] = expected;
  }
  return ownership;
}

async function isStrictLegacyGeneratedFile(relativePath: string): Promise<boolean> {
  const path = claudeManagedPath(relativePath);
  const metadata = await lstat(path).catch(() => null);
  if (!metadata) return false;
  if (!metadata.isFile()) return false;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    if (relativePath === ".cc-settings-hooks-fingerprint") {
      const value = parsed as Record<string, unknown>;
      return (
        typeof value.hash === "string" &&
        /^[a-f0-9]{64}$/.test(value.hash) &&
        typeof value.installedAt === "string" &&
        typeof value.hooksCount === "number"
      );
    }
    if (relativePath === ".cc-settings-src-manifest") {
      const value = parsed as Record<string, unknown>;
      return (
        value.files !== null &&
        typeof value.files === "object" &&
        !Array.isArray(value.files) &&
        Object.values(value.files as Record<string, unknown>).every(
          (hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash),
        )
      );
    }
    const value = parsed as Record<string, unknown>;
    return (
      value.settings !== null &&
      typeof value.settings === "object" &&
      !Array.isArray(value.settings)
    );
  } catch {
    return false;
  }
}

export async function prepareClaudeInstallOwnership(
  sourceDir: string,
  profile: Profile,
  sentinel: Awaited<ReturnType<typeof readDestructiveSentinel>>,
  options: { validateTargetCollisions?: boolean; claimManagedAbsentGenerated?: boolean } = {},
): Promise<PreparedClaudeInstallOwnership> {
  const nodeModulesTarget = await validateClaudeNodeModulesOwnership(sentinel);
  let files: Record<string, string> = {};
  if (sentinel?.managed_files) {
    files = Object.fromEntries(
      Object.entries(sentinel.managed_files).map(([path, hash]) => [path, hash.toLowerCase()]),
    );
  } else if (
    sentinel?.managed_files_state === "managed-absent" &&
    options.claimManagedAbsentGenerated !== false
  ) {
    for (const generated of [
      ".cc-settings-hooks-fingerprint",
      ".cc-settings-src-manifest",
      ".cc-settings-baseline.json",
    ]) {
      if (await isStrictLegacyGeneratedFile(generated)) {
        const hash = await regularFileHash(claudeManagedPath(generated));
        if (hash) files[generated] = hash;
      }
    }
  } else if (sentinel) {
    files = await historicalClaudeOwnership(
      sourceDir,
      sentinel.profile ?? "full",
      sentinel.version,
    );
    for (const generated of [
      ".cc-settings-hooks-fingerprint",
      ".cc-settings-src-manifest",
      ...(sentinel.profile === "light" ? [] : [".cc-settings-baseline.json"]),
    ]) {
      const metadata = await lstat(claudeManagedPath(generated)).catch(() => null);
      if (metadata && !(await isStrictLegacyGeneratedFile(generated))) {
        throw new Error(`Historical Claude generated ownership file is modified: ${generated}`);
      }
      if (metadata) {
        const hash = await regularFileHash(claudeManagedPath(generated));
        if (hash) files[generated] = hash;
      }
    }
  }

  const targetPaths = new Set([
    ...currentClaudeManagedSourceFiles(profile).map(({ destination }) => destination),
    ".cc-settings-hooks-fingerprint",
    ".cc-settings-src-manifest",
    ...(profile === "full" ? [".cc-settings-baseline.json"] : []),
  ]);
  for (const relativePath of options.validateTargetCollisions === false ? [] : targetPaths) {
    const metadata = await lstat(claudeManagedPath(relativePath)).catch((cause) => {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    });
    if (!metadata) continue;
    const expectedHash = files[relativePath];
    const actualHash = metadata.isFile()
      ? await regularFileHash(claudeManagedPath(relativePath))
      : null;
    if (!expectedHash || actualHash !== expectedHash) {
      throw new Error(
        `Claude managed destination collision: ${relativePath}. ` +
          "Preserve or rename the file, or reinstall the owning historical version before upgrading.",
      );
    }
  }
  const targetPathList = options.validateTargetCollisions === false ? [] : [...targetPaths];
  return {
    files,
    nodeModulesTarget,
    targetPaths: targetPathList,
    snapshot: await captureClaudeLifecycleOwnership(files, targetPathList, nodeModulesTarget),
  };
}

export async function hashInstalledProfileFiles(
  sourceDir: string,
  profile: Profile,
): Promise<Record<string, string>> {
  const managed: Record<string, string> = {};
  for (const [source, relativeDestination] of await profileFileMappings(sourceDir, profile)) {
    if ((await regularFileHash(source)) === null) continue;
    const installedHash = await regularFileHash(claudeManagedPath(relativeDestination));
    if (installedHash !== null) managed[relativeDestination] = installedHash;
  }
  return managed;
}

export async function addGeneratedManagedFiles(
  managedFiles: Record<string, string> | null,
  profile: Profile,
): Promise<Record<string, string>> {
  const managed = { ...(managedFiles ?? {}) };
  for (const relativePath of [
    ".cc-settings-hooks-fingerprint",
    ".cc-settings-src-manifest",
    ...(profile === "full" ? [".cc-settings-baseline.json"] : []),
  ]) {
    const hash = await regularFileHash(claudeManagedPath(relativePath));
    if (hash === null) {
      throw new Error(`Claude generated ownership file is missing or unsafe: ${relativePath}`);
    }
    managed[relativePath] = hash;
  }
  return managed;
}

export async function validateClaudeManagedFiles(
  managedFiles: Record<string, string> | null,
  sourceDir: string,
  profile: Profile,
  manifestVersion?: number,
): Promise<void> {
  if (!managedFiles) return;
  const inferredLegacy = manifestVersion === undefined;
  await validateClaudeManagedFileOwnership(
    managedFiles,
    sourceDir,
    profile,
    CLAUDE_DIR,
    inferredLegacy ? "exact" : "upgrade",
    manifestVersion ?? 1,
  );
  if (inferredLegacy) {
    for (const [relativePath, expectedHash] of Object.entries(managedFiles)) {
      if ((await regularFileHash(claudeManagedPath(relativePath))) !== expectedHash.toLowerCase()) {
        throw new Error(
          `Legacy Claude managed_files ownership does not match the live file: ${relativePath}. ` +
            "Reinstall cc-settings once to establish versioned ownership metadata.",
        );
      }
    }
  }
}

export async function removeOwnedClaudeFiles(
  sourceDir: string,
  profile: Profile,
  managedFiles: Record<string, string> | null,
  manifestVersion?: number,
  nodeModulesTarget: string | null = null,
): Promise<void> {
  const candidates = new Map<string, string>();
  if (managedFiles) {
    await validateClaudeManagedFiles(managedFiles, sourceDir, profile, manifestVersion);
    for (const [relativePath, hash] of Object.entries(managedFiles)) {
      candidates.set(relativePath, hash.toLowerCase());
    }
  } else {
    for (const [source, relativeDestination] of await profileFileMappings(sourceDir, profile)) {
      const sourceHash = await regularFileHash(source);
      if (sourceHash !== null) candidates.set(relativeDestination, sourceHash);
    }
  }

  await removeClaudeFilesWithHashes(Object.fromEntries(candidates), nodeModulesTarget);
}

export async function removeClaudeFilesWithHashes(
  managedFiles: Record<string, string>,
  expectedNodeModulesTarget: string | null,
): Promise<void> {
  const candidates = new Map(
    Object.entries(managedFiles).map(([relativePath, hash]) => [relativePath, hash.toLowerCase()]),
  );

  const removedPaths: string[] = [];
  for (const [relativePath, expectedHash] of candidates) {
    const destination = claudeManagedPath(relativePath);
    if ((await regularFileHash(destination)) !== expectedHash) continue;
    await rm(destination, { force: true });
    removedPaths.push(destination);
  }

  const installedNodeModules = claudeManagedPath(join("src", "node_modules"));
  try {
    await lstat(installedNodeModules);
    if (
      !expectedNodeModulesTarget ||
      !(await claudeNodeModulesMatches(installedNodeModules, expectedNodeModulesTarget))
    ) {
      throw new Error(
        "Claude managed destination collision: src/node_modules changed after ownership preflight.",
      );
    }
    await rm(installedNodeModules, { recursive: true, force: true });
    removedPaths.push(installedNodeModules);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }

  const directories = new Set<string>();
  for (const path of removedPaths) {
    let directory = resolve(path, "..");
    while (directory !== resolve(CLAUDE_DIR)) {
      directories.add(directory);
      directory = resolve(directory, "..");
    }
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    try {
      await rmdir(directory);
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTEMPTY") throw cause;
    }
  }
}

export async function writeVersionSentinel(
  sourceDir: string,
  version: string,
  profile: Profile,
  engine: EngineDescriptor,
  autoUpdate: boolean | undefined,
  // Whether THIS run resolved the engine explicitly (env override, or a
  // previously-explicit sentinel) — see resolveEngine in code-intel-engine.ts.
  // ALWAYS written, true or false. Writing it unconditionally is what makes
  // ABSENCE mean exactly one thing: "stamped before this field existed". That
  // is the only case where resolveEngine falls back to inferring intent from
  // the engine id, so leaving the field out on `false` would make a fresh
  // implicit install indistinguishable from a legacy sentinel and wrongly pin
  // whatever the default happened to be.
  explicit: boolean,
  // cc-settings' definition of each managed MCP server as written this run.
  // Null on a light install or when no MCP block was installed.
  mcpWritten?: McpServers | null,
  managedFiles?: Record<string, string> | null,
  managedFilesManifestVersion: number | null = CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION,
  installedVersion: string | null = version,
  managedFilesState?: "managed-absent",
): Promise<void> {
  const payload: Sentinel = {
    ...(installedVersion !== null ? { version: installedVersion } : {}),
    installed_at: new Date().toISOString(),
    // Where this install came from — lets the SessionStart drift check locate
    // the repo and compare the installed version against the packaged one.
    repo_path: sourceDir,
    profile,
    // Resolved code-intel engine id — read back by resolveEngine() so every
    // surface (hooks, next install) agrees on which engine backs `tldr`.
    engine: engine.id,
    engine_explicit: explicit,
    // cc-settings' own definition of EVERY managed server as of this run — lets
    // a LATER install's isStaleCcOutput recognize yesterday's output as ours
    // even after the shipped definition has since changed. Without it, the only
    // recognizable shapes are the ones the CURRENT code would generate, so any
    // edit to a server's definition orphans the entry it replaced: that entry
    // then matches nothing, reads as a hand-edit, and is preserved forever.
    // Recorded fact beats derived-from-code-that-may-have-changed.
    //
    // Records what WE ship, not what ended up on disk. Where the user's copy
    // shadowed ours (see installMcpToClaudeJson's return), disk holds theirs —
    // echoing that would make the next install recognize their customization as
    // our stale output and clobber it. Ours is the safe thing to remember: an
    // entry equal to what we shipped last time is unambiguously replaceable.
    //
    // FULL PROFILE ONLY. A light install REMOVES the managed servers
    // (removeManagedMcpServers), so recording what a full install would have
    // written would claim ownership of entries this run did not write — and a
    // later install could then misread a user's own entry as our stale output.
    // Omitting it is the safe direction: the worst case is one missed stale
    // match, which merely preserves an entry instead of clobbering one.
    ...(profile === "full" && mcpWritten ? { mcp_written: mcpWritten } : {}),
    ...(managedFiles ? { managed_files: managedFiles } : {}),
    ...(managedFilesManifestVersion !== null
      ? { managed_files_manifest_version: managedFilesManifestVersion }
      : {}),
    ...(managedFilesState ? { managed_files_state: managedFilesState } : {}),
    // Auto-update enrollment — omitted entirely when undecided (non-macOS, or
    // a non-interactive run with no prior decision) so "absent" never reads
    // as "declined". See decideAutoUpdate() in src/lib/schedule.ts.
    ...(autoUpdate !== undefined ? { auto_update: autoUpdate } : {}),
  };
  await writeSentinel(CLAUDE_DIR, payload);
}
