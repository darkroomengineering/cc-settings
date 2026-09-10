import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  assertRuntimeSourceFile,
  type CodexInstallPaths,
  type CodexSentinel,
  contentHash,
  lstatOrNull,
  MANAGED_RULE_NAME,
  type NativeAgent,
  regularFileHash,
  runCommand,
} from "./codex-install-state.ts";
import { loadNativeAgents, managedBlockRange } from "./codex-native-agents.ts";
import {
  REQUIRED_SOURCE_ARTIFACTS,
  RUNTIME_SOURCE_FILES,
  runtimePathsForVersion,
} from "./codex-runtime-manifests.ts";

async function runtimeSourceFileExists(sourceDir: string, label: string): Promise<boolean> {
  let current = sourceDir;
  const segments = label.split("/");
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index] as string);
    const metadata = await lstatOrNull(current);
    if (!metadata) return false;
    if (metadata.isSymbolicLink()) {
      throw new Error(`Codex managed source contains a symlink: ${label}`);
    }
    const isLast = index === segments.length - 1;
    if (isLast ? !metadata.isFile() : !metadata.isDirectory()) {
      throw new Error(`Codex managed runtime artifact has the wrong type: ${label}`);
    }
  }
  return true;
}

export async function copyRuntimeManifest(
  sourceDir: string,
  destinationDir: string,
  artifacts: readonly string[] = RUNTIME_SOURCE_FILES,
): Promise<void> {
  await mkdir(destinationDir, { recursive: true });
  for (const artifact of artifacts) {
    if (!(await runtimeSourceFileExists(sourceDir, artifact))) continue;
    const destination = join(destinationDir, artifact);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(sourceDir, artifact), destination, { force: true });
  }
}

export async function runtimeManifestHashes(
  sourceDir: string,
  artifacts: readonly string[] = RUNTIME_SOURCE_FILES,
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const artifact of artifacts) {
    if (!(await runtimeSourceFileExists(sourceDir, artifact))) continue;
    hashes[artifact] = contentHash(await readFile(join(sourceDir, artifact)));
  }
  return hashes;
}

async function assertManagedSourceContainsOnlyRuntime(
  sourceDir: string,
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
  const visit = async (directory: string, prefix = ""): Promise<void> => {
    for (const entry of await readdir(directory)) {
      const relativePath = prefix ? `${prefix}/${entry}` : entry;
      const path = join(directory, entry);
      const metadata = await lstat(path);
      if (relativePath === "node_modules") {
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
          throw new Error(`Unsafe managed dependency directory: ${path}`);
        }
        continue;
      }
      if (metadata.isSymbolicLink()) {
        throw new Error(`Unexpected symlink in managed Codex source: ${path}`);
      }
      if (metadata.isDirectory()) {
        if (!allowedDirectories.has(relativePath)) {
          throw new Error(`Unexpected directory in managed Codex source: ${path}`);
        }
        await visit(path, relativePath);
      } else if (!metadata.isFile() || !allowedFiles.has(relativePath)) {
        throw new Error(`Unexpected file in managed Codex source: ${path}`);
      }
    }
  };
  await visit(sourceDir);
}

export async function assertPreviousManagedContentUnmodified(
  paths: CodexInstallPaths,
  previous: CodexSentinel,
  checkNativeFiles: boolean,
): Promise<void> {
  const conflicts: string[] = [];
  if (checkNativeFiles) {
    for (const name of previous.managed_agents) {
      const path = join(paths.agentsDir, `${name}.toml`);
      if ((await regularFileHash(path)) !== previous.managed_agent_hashes?.[name]) {
        conflicts.push(path);
      }
    }
    const rulePath = join(paths.rulesDir, MANAGED_RULE_NAME);
    if (
      previous.profile === "full" &&
      (await regularFileHash(rulePath)) !== previous.managed_rule_hash
    ) {
      conflicts.push(rulePath);
    }
  }

  const installedSource = await lstatOrNull(paths.managedSource);
  if (!installedSource) {
    conflicts.push(paths.managedSource);
  } else {
    const runtimePaths = runtimePathsForVersion(
      previous.runtime_manifest_version,
      paths.sentinelPath,
    );
    await assertManagedSourceContainsOnlyRuntime(paths.managedSource, runtimePaths);
    const live = await runtimeManifestHashes(paths.managedSource, runtimePaths);
    for (const relativePath of runtimePaths) {
      if (previous.managed_source_hashes?.[relativePath] !== live[relativePath]) {
        conflicts.push(join(paths.managedSource, relativePath));
      }
    }
  }

  const instructions = await readFile(paths.globalInstructionsPath, "utf8").catch(() => null);
  if (instructions === null) {
    conflicts.push(paths.globalInstructionsPath);
  } else {
    const range = managedBlockRange(instructions);
    if (!range) {
      conflicts.push(paths.globalInstructionsPath);
    } else {
      const hash = contentHash(instructions.slice(range.start, range.end));
      if (!previous.managed_instructions_hash || hash !== previous.managed_instructions_hash) {
        conflicts.push(paths.globalInstructionsPath);
      }
    }
  }
  if (conflicts.length > 0) {
    throw new Error(
      `Codex install would overwrite modified managed content: ${[...new Set(conflicts)].join(", ")}`,
    );
  }
}

export async function preflightCodexSource(sourceDir: string): Promise<NativeAgent[]> {
  const sourceMetadata = await lstat(sourceDir);
  if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isDirectory()) {
    throw new Error(`Codex install source is not a safe directory: ${sourceDir}`);
  }
  const missing = REQUIRED_SOURCE_ARTIFACTS.filter(
    (artifact) => !existsSync(join(sourceDir, artifact)),
  );
  if (missing.length > 0) {
    throw new Error(`Codex install source is incomplete: ${missing.join(", ")}`);
  }
  await Promise.all([
    ...[
      "AGENTS.md",
      "codex/AGENTS.append.md",
      `codex/rules/${MANAGED_RULE_NAME}`,
      ".claude-plugin/marketplace.json",
      ".codex-plugin/plugin.json",
      ".mcp.json",
      "hooks/hooks.json",
    ].map((artifact) => assertRuntimeSourceFile(sourceDir, artifact)),
    ...RUNTIME_SOURCE_FILES.map((artifact) => assertRuntimeSourceFile(sourceDir, artifact)),
  ]);
  await assertRuntimeImportClosure(sourceDir);
  return await loadNativeAgents(sourceDir);
}

async function assertRuntimeImportClosure(sourceDir: string): Promise<void> {
  const selected = new Set<string>(RUNTIME_SOURCE_FILES);
  const missing = new Set<string>();
  const importPattern = /(?:from\s*|import\s*\()\s*["'](\.[^"']+)["']/g;
  for (const artifact of RUNTIME_SOURCE_FILES) {
    if (!artifact.endsWith(".ts")) continue;
    const content = await readFile(join(sourceDir, artifact), "utf8");
    for (const match of content.matchAll(importPattern)) {
      const specifier = match[1] as string;
      const imported = relative(sourceDir, resolve(dirname(join(sourceDir, artifact)), specifier))
        .split(sep)
        .join("/");
      if (imported.endsWith(".ts") && !selected.has(imported)) missing.add(imported);
    }
  }
  if (missing.size > 0) {
    throw new Error(
      `Codex runtime manifest omits transitive local imports: ${[...missing].sort().join(", ")}`,
    );
  }
}

export async function prepareManagedSource(
  sourceDir: string,
  paths: CodexInstallPaths,
  artifacts: readonly string[] = RUNTIME_SOURCE_FILES,
): Promise<string> {
  const staging = `${paths.managedSource}.tmp-${process.pid}-${Date.now()}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(dirname(staging), { recursive: true });
  try {
    await copyRuntimeManifest(sourceDir, staging, artifacts);
    await ensureRuntimeDependencies(staging, paths.codexHome);
    await assertManagedSourceContainsOnlyRuntime(staging, artifacts);
    return staging;
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function installPreparedManagedSource(
  paths: CodexInstallPaths,
  staging: string | null,
): Promise<void> {
  if (staging === null) {
    await rm(paths.managedSource, { recursive: true, force: true });
    return;
  }
  const previous = `${paths.managedSource}.previous-${process.pid}-${Date.now()}`;
  const live = await lstat(paths.managedSource).catch(() => null);
  if (live && (!live.isDirectory() || live.isSymbolicLink())) {
    throw new Error(`Unsafe managed Codex source boundary: ${paths.managedSource}`);
  }
  await rm(previous, { recursive: true, force: true });
  if (live) await rename(paths.managedSource, previous);
  try {
    await rename(staging, paths.managedSource);
  } catch (cause) {
    if (live) await rename(previous, paths.managedSource);
    throw cause;
  }
  await rm(previous, { recursive: true, force: true });
}

async function ensureRuntimeDependencies(sourcePath: string, codexHome: string): Promise<void> {
  if (process.env.CC_SKIP_DEPS === "1") return;
  const result = await runCommand(
    ["bun", "install", "--production", "--frozen-lockfile", "--ignore-scripts"],
    codexHome,
    sourcePath,
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Codex managed runtime dependency install failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  const nodeModules = await lstat(join(sourcePath, "node_modules")).catch(() => null);
  if (!nodeModules?.isDirectory() || nodeModules.isSymbolicLink()) {
    throw new Error("Codex managed runtime dependency install produced an unsafe node_modules");
  }
}
