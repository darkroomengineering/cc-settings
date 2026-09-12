import { existsSync, type Stats } from "node:fs";
import { chmod, cp, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { runtimePathsForVersion } from "./codex-runtime-manifests.ts";
import { isPlainObject } from "./merge-keyed.ts";
import { sha256, whichCommand } from "./platform.ts";

export const INSTRUCTIONS_START = "<!-- cc-settings:codex:start -->";
export const INSTRUCTIONS_END = "<!-- cc-settings:codex:end -->";
const SENTINEL_NAME = ".cc-settings-version";
export const MANAGED_RULE_NAME = "darkroom.rules";
export const MAX_BACKUPS = 10;
export const MANAGED_AGENT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SHA256 = /^[a-f0-9]{64}$/;
export const SHARED_BACKUP_ID = /^\d{14}-\d{3}-\d+-\d+$/;
export const STRICT_VERSION = /^\d+\.\d+\.\d+$/;
export const RETIRED_MANAGED_AGENT_NAMES = new Set<string>();
export const MANAGED_AGENT_SOURCE_FILES = [
  "deslopper.md",
  "explore.md",
  "implementer.md",
  "maestro.md",
  "planner.md",
  "reviewer.md",
  "scaffolder.md",
  "security-reviewer.md",
  "tester.md",
] as const;
export const EXCLUDED_AGENT_SOURCE_FILES = new Set(["codex-verifier.md"]);
/** Agent sources that exist only for standalone Codex, under `codex/agents/`.
 *  They mirror Claude-only agents in the other direction (claude-verifier is
 *  the Codex-to-Claude twin of codex-verifier) and are never installed to Claude. */
export const CODEX_ONLY_AGENT_SOURCE_FILES = ["claude-verifier.md"] as const;
/** Claude agent tiers mapped to Codex models. Judgment tiers (opus, fable) run on
 *  GPT-6 Astra; execution tiers (sonnet, haiku) run on GPT-5.6 Sol, which
 *  continues through long tasks. Unknown or unset tiers inherit the session model. */
export const CODEX_MODEL_FOR_CLAUDE_TIER: Readonly<Record<string, string>> = {
  opus: "gpt-6-astra",
  "claude-opus-5": "gpt-6-astra",
  fable: "gpt-6-astra",
  "claude-fable-5-1": "gpt-6-astra",
  sonnet: "gpt-5.6-sol",
  "claude-sonnet-5": "gpt-5.6-sol",
  haiku: "gpt-5.6-sol",
  "claude-haiku-4-5-20251001": "gpt-5.6-sol",
};
export function codexModelForClaudeModel(model: unknown): string | undefined {
  if (typeof model !== "string") return undefined;
  const base = model.replace(/\[.*\]$/, "").trim();
  return CODEX_MODEL_FOR_CLAUDE_TIER[base];
}
export const CODEX_ADAPTER = `Native Codex adapter:
- Treat Claude tool names in this shared source as capability names, not literal calls. Inspect and search with exec_command plus rg; edit with apply_patch.
- Delegate with spawn_agent. Use followup_task to trigger another turn for an idle existing agent, send_message to deliver context to a running agent, wait_agent to wait, and interrupt_agent to stop its current turn when necessary.
- Treat Agent as spawn_agent and AskUserQuestion as reporting the blocking question to the parent agent. Agent lifecycle APIs can vary by host, so prefer these capabilities over guessed aliases.
- Follow AGENTS.md for repository instructions. Claude-specific output styles, status lines, agent teams, and worktree isolation are unavailable unless the active Codex surface explicitly exposes an equivalent; serialize file-writing agents when isolation is unavailable.
- Do not invoke codex-verifier or codex-run.ts from inside Codex. For an independent Claude opinion, spawn claude-verifier or run the claude-run.ts bridge (review and ask only; it never edits). Claude-only helper paths and the tldr binary are optional; use native Codex tools when they are absent.
- Define done before starting and work until it holds: run the repository's local checks, inspect the result, and fix what your change broke. Do not return after a first implementation for a review nobody asked for. Ask only for a decision the requester owns.`;

export type CodexProfile = "full" | "light";

export interface CodexInstallPaths {
  homeDir: string;
  codexHome: string;
  managedSource: string;
  backupsDir: string;
  sentinelPath: string;
  agentsDir: string;
  rulesDir: string;
  globalInstructionsPath: string;
  configPath: string;
}

export interface CodexInstallOptions {
  sourceDir: string;
  version: string;
  profile: CodexProfile;
  backupId?: string;
  homeDir?: string;
}

export interface CodexRollbackOptions {
  target: string | true;
  backupId?: string;
  homeDir?: string;
}

export interface CodexRollbackResult {
  restoredBackup: string;
  compensationBackup: string;
}

export interface CodexUninstallOptions {
  sourceDir?: string;
  backupId?: string;
  homeDir?: string;
}

export interface CodexStatusOptions {
  sourceDir?: string;
  homeDir?: string;
}

export interface CodexDryRunOptions {
  sourceDir: string;
  profile: CodexProfile;
  homeDir?: string;
}

export interface CodexStatus {
  installedVersion: string | null;
  packagedVersion: string | null;
  versionWarning: string | null;
  installedProfile: CodexProfile | null;
  instructionBlockPresent: boolean;
  pluginInstalled: boolean | null;
  nativeAgentCount: number;
  rulePresent: boolean;
  sourcePresent: boolean;
}

export interface CodexSentinel {
  version: string;
  installed_at: string;
  profile: CodexProfile;
  repo_path: string;
  managed_agents: string[];
  managed_agent_hashes?: Record<string, string>;
  managed_rule_hash?: string;
  managed_source_hashes?: Record<string, string>;
  managed_instructions_hash?: string;
  runtime_manifest_version: number;
}

export interface BackupManifest {
  createdAt: string;
  restoreScope: "exact" | "managed-absent";
  present: string[];
  previousManagedAgents: string[];
  nextManagedAgents: string[];
  pluginState: BackupPluginState | null;
  restoredProfile: CodexProfile | null;
  payloadHashes: Record<string, string>;
  runtimeManifestVersion: number | null;
}

export interface CodexPluginState {
  pluginInstalled: boolean;
  pluginEnabled: boolean;
  marketplaceEnrolled: boolean;
  pluginSource: string | null;
  marketplaceSource: string | null;
}

export interface BackupPluginState extends CodexPluginState {
  restoreMode: "managed-restorable" | "independent-preserve-only";
}

/** Drop `restoreMode` to compare a backup's recorded plugin state against a
 *  live `CodexPluginState` reading. */
export function toPluginState(state: BackupPluginState): CodexPluginState {
  return {
    pluginInstalled: state.pluginInstalled,
    pluginEnabled: state.pluginEnabled,
    marketplaceEnrolled: state.marketplaceEnrolled,
    pluginSource: state.pluginSource,
    marketplaceSource: state.marketplaceSource,
  };
}

export interface NativeAgent {
  name: string;
  description: string;
  developerInstructions: string;
  model?: string;
  modelReasoningEffort?: "low" | "medium" | "high" | "xhigh";
  sandboxMode: "read-only" | "workspace-write";
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function errorDetail(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

/** `lstat`, treating a missing path as `null` instead of throwing ENOENT. */
export async function lstatOrNull(path: string): Promise<Stats | null> {
  return await lstat(path).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return null;
    throw cause;
  });
}

export function codexInstallPaths(home?: string): CodexInstallPaths {
  const homeDir = resolve(home ?? homedir());
  const codexHome =
    home === undefined && process.env.CODEX_HOME
      ? resolve(process.env.CODEX_HOME)
      : join(homeDir, ".codex");
  const paths: CodexInstallPaths = {
    homeDir,
    codexHome,
    managedSource: join(codexHome, "darkroom", "source"),
    backupsDir: join(codexHome, "backups", "cc-settings"),
    sentinelPath: join(codexHome, SENTINEL_NAME),
    agentsDir: join(codexHome, "agents"),
    rulesDir: join(codexHome, "rules"),
    globalInstructionsPath: join(codexHome, "AGENTS.md"),
    configPath: join(codexHome, "config.toml"),
  };
  assertSafeManagedPaths(paths);
  return paths;
}

function assertSafeManagedPaths(paths: CodexInstallPaths): void {
  if (paths.codexHome === resolve(sep)) {
    throw new Error("Refusing to use the filesystem root as CODEX_HOME");
  }
  for (const path of [
    paths.managedSource,
    paths.backupsDir,
    paths.sentinelPath,
    paths.agentsDir,
    paths.rulesDir,
    paths.globalInstructionsPath,
    paths.configPath,
  ]) {
    const rel = relative(paths.codexHome, resolve(path));
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) {
      throw new Error(`Unsafe Codex managed path: ${path}`);
    }
  }
}

async function assertExistingBoundary(
  path: string,
  codexPath: string,
  codexRoot: string,
  expectedLeaf: "file" | "directory",
): Promise<void> {
  const rel = relative(codexPath, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Codex boundary escapes CODEX_HOME: ${path}`);
  }
  const segments = rel.split(sep);
  let current = codexPath;
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index] as string);
    const metadata = await lstatOrNull(current);
    if (!metadata) return;
    if (metadata.isSymbolicLink()) {
      throw new Error(`Refusing symlinked Codex boundary: ${current}`);
    }
    const isLast = index === segments.length - 1;
    const shouldBeDirectory = !isLast || expectedLeaf === "directory";
    if (shouldBeDirectory ? !metadata.isDirectory() : !metadata.isFile()) {
      throw new Error(`Wrong Codex boundary type: ${current}`);
    }
    const resolvedPath = await realpath(current);
    const fromRoot = relative(codexRoot, resolvedPath);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`Codex boundary escapes CODEX_HOME: ${current}`);
    }
  }
}

export async function assertCodexBoundaries(paths: CodexInstallPaths): Promise<void> {
  const absoluteHome = resolve(paths.codexHome);
  const root = parse(absoluteHome).root;
  let ancestor = root;
  for (const segment of absoluteHome.slice(root.length).split(sep).filter(Boolean)) {
    ancestor = join(ancestor, segment);
    const metadata = await lstatOrNull(ancestor);
    if (!metadata) break;
    const platformRootAlias = dirname(ancestor) === root;
    if (metadata.isSymbolicLink() && !platformRootAlias) {
      throw new Error(`Refusing symlinked CODEX_HOME ancestor: ${ancestor}`);
    }
    if (!metadata.isDirectory() && !metadata.isSymbolicLink()) {
      throw new Error(`CODEX_HOME ancestor is not a directory: ${ancestor}`);
    }
  }
  let codexRoot = paths.codexHome;
  try {
    const metadata = await lstat(paths.codexHome);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Refusing symlinked CODEX_HOME: ${paths.codexHome}`);
    }
    if (!metadata.isDirectory()) {
      throw new Error(`CODEX_HOME is not a directory: ${paths.codexHome}`);
    }
    codexRoot = await realpath(paths.codexHome);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
  const boundaries: Array<[string, "file" | "directory"]> = [
    [paths.agentsDir, "directory"],
    [paths.rulesDir, "directory"],
    [join(paths.codexHome, "darkroom"), "directory"],
    [paths.managedSource, "directory"],
    [join(paths.codexHome, "backups"), "directory"],
    [paths.backupsDir, "directory"],
    [join(paths.codexHome, "tmp"), "directory"],
    [join(paths.codexHome, "tmp", "install.lock"), "file"],
    [join(paths.codexHome, ".tmp"), "directory"],
    [join(paths.codexHome, ".tmp", "marketplaces"), "directory"],
    [join(paths.codexHome, "plugins"), "directory"],
    [join(paths.codexHome, "plugins", "cache"), "directory"],
    [paths.globalInstructionsPath, "file"],
    [paths.configPath, "file"],
    [paths.sentinelPath, "file"],
    [join(paths.rulesDir, MANAGED_RULE_NAME), "file"],
  ];
  for (const [path, expectedLeaf] of boundaries) {
    await assertExistingBoundary(path, paths.codexHome, codexRoot, expectedLeaf);
  }
}

/** Validate all existing managed ancestors before setup creates its Codex lock. */
export async function validateCodexInstallBoundaries(
  options: { homeDir?: string } = {},
): Promise<void> {
  await assertCodexBoundaries(codexInstallPaths(options.homeDir));
}

async function canonicalPathWithMissingSuffix(path: string): Promise<string> {
  let cursor = resolve(path);
  const missing: string[] = [];
  while (true) {
    const metadata = await lstatOrNull(cursor);
    if (metadata) {
      const base = await realpath(cursor);
      return resolve(base, ...missing);
    }
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error(`Cannot resolve managed root: ${path}`);
    missing.unshift(basename(cursor));
    cursor = parent;
  }
}

/** Reject overlapping Claude/Codex homes before either product mutates disk. */
export async function validateProductRootDisjointness(
  claudeDir: string,
  options: { homeDir?: string } = {},
): Promise<void> {
  const paths = codexInstallPaths(options.homeDir);
  await assertCodexBoundaries(paths);
  const [claudeRoot, codexRoot] = await Promise.all([
    canonicalPathWithMissingSuffix(claudeDir),
    canonicalPathWithMissingSuffix(paths.codexHome),
  ]);
  const claudeToCodex = relative(claudeRoot, codexRoot);
  const codexToClaude = relative(codexRoot, claudeRoot);
  const contains = (value: string): boolean =>
    value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
  if (contains(claudeToCodex) || contains(codexToClaude)) {
    throw new Error(`Claude/Codex home collision: ${claudeRoot} and ${codexRoot} must be disjoint`);
  }
}

export async function assertManagedAgentBoundaries(
  paths: CodexInstallPaths,
  names: string[],
): Promise<void> {
  const codexRoot = existsSync(paths.codexHome) ? await realpath(paths.codexHome) : paths.codexHome;
  for (const name of names) {
    if (!MANAGED_AGENT_NAME.test(name)) throw new Error(`Unsafe managed agent name: ${name}`);
    await assertExistingBoundary(
      join(paths.agentsDir, `${name}.toml`),
      paths.codexHome,
      codexRoot,
      "file",
    );
  }
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function validatedAgentNames(value: unknown, source: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Invalid managed agent names in ${source}`);
  }
  const names = value as string[];
  if (new Set(names).size !== names.length) {
    throw new Error(`Duplicate managed agent names in ${source}`);
  }
  for (const name of names) {
    if (!MANAGED_AGENT_NAME.test(name)) throw new Error(`Unsafe managed agent name: ${name}`);
  }
  return names;
}

function validatedAgentHashes(
  value: unknown,
  names: string[],
  source: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) throw new Error(`Invalid managed agent hashes in ${source}`);
  const hashes: Record<string, string> = {};
  for (const [name, hash] of Object.entries(value)) {
    if (!MANAGED_AGENT_NAME.test(name) || typeof hash !== "string" || !SHA256.test(hash)) {
      throw new Error(`Invalid managed agent hash in ${source}: ${name}`);
    }
    if (!names.includes(name))
      throw new Error(`Hash for unlisted managed agent in ${source}: ${name}`);
    hashes[name] = hash;
  }
  return hashes;
}

export async function readSentinel(path: string): Promise<CodexSentinel | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isPlainObject(value)) throw new Error(`Invalid Codex sentinel: ${path}`);
    if (
      typeof value.version !== "string" ||
      typeof value.installed_at !== "string" ||
      (value.profile !== "full" && value.profile !== "light") ||
      typeof value.repo_path !== "string"
    ) {
      throw new Error(`Invalid Codex sentinel: ${path}`);
    }
    const managedAgents = validatedAgentNames(value.managed_agents, path);
    const runtimeManifestVersion = value.runtime_manifest_version;
    const runtimePaths = runtimePathsForVersion(runtimeManifestVersion, path);
    const managedAgentHashes = validatedAgentHashes(
      value.managed_agent_hashes,
      managedAgents,
      path,
    );
    const managedRuleHash = value.managed_rule_hash;
    if (
      managedRuleHash !== undefined &&
      (typeof managedRuleHash !== "string" || !SHA256.test(managedRuleHash))
    ) {
      throw new Error(`Invalid managed rule hash in ${path}`);
    }
    const managedInstructionsHash = value.managed_instructions_hash;
    if (
      managedInstructionsHash !== undefined &&
      (typeof managedInstructionsHash !== "string" || !SHA256.test(managedInstructionsHash))
    ) {
      throw new Error(`Invalid managed instructions hash in ${path}`);
    }
    const managedSourceHashes = value.managed_source_hashes;
    if (managedSourceHashes !== undefined && !isPlainObject(managedSourceHashes)) {
      throw new Error(`Invalid managed source hashes in ${path}`);
    }
    const sourceHashes: Record<string, string> = {};
    if (isPlainObject(managedSourceHashes)) {
      for (const [relativePath, hash] of Object.entries(managedSourceHashes)) {
        if (!runtimePaths.includes(relativePath)) {
          throw new Error(`Unowned managed source path in ${path}: ${relativePath}`);
        }
        if (typeof hash !== "string" || !SHA256.test(hash)) {
          throw new Error(`Invalid managed source hash in ${path}: ${relativePath}`);
        }
        sourceHashes[relativePath] = hash;
      }
    }
    return {
      version: value.version,
      installed_at: value.installed_at,
      profile: value.profile,
      repo_path: value.repo_path,
      runtime_manifest_version: runtimeManifestVersion as number,
      managed_agents: managedAgents,
      ...(managedAgentHashes ? { managed_agent_hashes: managedAgentHashes } : {}),
      ...(typeof managedRuleHash === "string" ? { managed_rule_hash: managedRuleHash } : {}),
      ...(managedSourceHashes ? { managed_source_hashes: sourceHashes } : {}),
      ...(typeof managedInstructionsHash === "string"
        ? { managed_instructions_hash: managedInstructionsHash }
        : {}),
    };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

/** Read only the installed Codex version from the filesystem sentinel. */
export async function readCodexInstalledVersion(homeDir?: string): Promise<string | null> {
  const sentinel = await readSentinel(codexInstallPaths(homeDir).sentinelPath);
  return sentinel?.version ?? null;
}

/** Test-only escape hatch for fixtures that do not execute a real Codex CLI. */
export function isCodexCliSkippedForTests(): boolean {
  return process.env.NODE_ENV === "test" && process.env.CC_SKIP_CODEX_CLI === "1";
}

function testCodexCommand(): string[] | null {
  if (process.env.NODE_ENV !== "test" || process.env.CC_SETTINGS_TEST_MODE !== "codex-install") {
    return null;
  }
  const encoded = process.env.CC_SETTINGS_TEST_CODEX_COMMAND_JSON;
  if (!encoded) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error("Invalid CC_SETTINGS_TEST_CODEX_COMMAND_JSON");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((part) => typeof part !== "string" || !isAbsolute(part))
  ) {
    throw new Error("CC_SETTINGS_TEST_CODEX_COMMAND_JSON must contain absolute command paths");
  }
  return parsed as string[];
}

// Memoized probe result. `null` = not yet probed; `boolean` = final answer for
// this process. Cleared via `resetCodexCliAvailabilityMemoForTests()` between
// test scenarios that install/uninstall codex under a synthetic PATH.
let codexCliAvailabilityMemo: boolean | null = null;

/** Test-only: reset the memoized probe so PATH changes take effect. */
export function resetCodexCliAvailabilityMemoForTests(): void {
  codexCliAvailabilityMemo = null;
}

export function codexCliAvailable(): boolean {
  // Test escape hatch: an explicit fixture command bypasses PATH resolution
  // entirely and is always considered available.
  if (testCodexCommand() !== null) return true;
  if (codexCliAvailabilityMemo !== null) return codexCliAvailabilityMemo;
  // Resolve against the live PATH and spawn the resolved absolute path, so a
  // runtime PATH change (tests installing shims) actually steers the probe.
  const codexPath = whichCommand("codex");
  if (codexPath === null) {
    codexCliAvailabilityMemo = false;
    return false;
  }
  // A binary named `codex` is on PATH, but proxy shims (e.g. cmux CLI shims
  // at $TMPDIR/cmux-cli-shims/.../codex) can pass the existence check while
  // failing on invocation. Probe with `codex --version` and require the
  // output to actually look like a codex version banner, because at least
  // one shim (cmux) prints "Error: codex not found in PATH" and still exits
  // 0 — exit code alone is not enough. A 3s cap keeps a hung shim from
  // stalling setup.
  try {
    const probe = Bun.spawnSync({
      cmd: [codexPath, "--version"],
      stdout: "pipe",
      stderr: "pipe",
      timeout: 3000,
    });
    const stdout = probe.stdout ? new TextDecoder().decode(probe.stdout) : "";
    codexCliAvailabilityMemo = probe.exitCode === 0 && looksLikeCodexVersion(stdout);
  } catch {
    codexCliAvailabilityMemo = false;
  }
  return codexCliAvailabilityMemo;
}

/** Real `codex --version` prints a line like `codex-cli 0.15.2` or
 *  `codex 0.15.2` — a leading `codex` token followed by a semver-ish
 *  number. Shims that swallow the invocation with an error message do
 *  not match. Kept as a fragment match so a future banner prefix (e.g.
 *  `codex 0.16.0 (release build)`) still passes. */
export function looksLikeCodexVersion(output: string): boolean {
  return /\bcodex[\w-]*\s+\d+\.\d+/i.test(output);
}

export async function assertRuntimeSourceFile(sourceDir: string, label: string): Promise<void> {
  let current = sourceDir;
  for (const segment of label.split("/")) {
    current = join(current, segment);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Codex source contains a symlink: ${label}`);
    }
  }
  const metadata = await lstat(current);
  if (!metadata.isFile()) throw new Error(`Codex runtime artifact is not a file: ${label}`);
}

export function backupRelativePath(path: string, paths: CodexInstallPaths): string {
  return relative(paths.codexHome, path);
}

export async function copyIfPresent(source: string, destination: string): Promise<boolean> {
  if (!existsSync(source)) return false;
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
  return true;
}

export function contentHash(content: string | Uint8Array): string {
  return sha256(content);
}

export async function regularFileHash(path: string): Promise<string | null> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile()) return null;
    return contentHash(await readFile(path));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

export async function removeFileWithHash(
  path: string,
  expectedHash: string | undefined,
): Promise<boolean> {
  if (!expectedHash || (await regularFileHash(path)) !== expectedHash) return false;
  await rm(path, { force: true });
  return true;
}

export async function runCommand(
  command: string[],
  codexHome: string,
  cwd?: string,
): Promise<CommandResult> {
  const explicitCodex = command[0] === "codex" ? testCodexCommand() : null;
  const resolvedCommand = explicitCodex ? [...explicitCodex, ...command.slice(1)] : command;
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: codexHome };
  if (explicitCodex) {
    if (env.HOME) env.HOME = env.HOME.replaceAll("\\", "/");
    if (env.USERPROFILE) env.USERPROFILE = env.USERPROFILE.replaceAll("\\", "/");
    env.CODEX_HOME = codexHome.replaceAll("\\", "/");
  }
  const child = Bun.spawn(resolvedCommand, {
    ...(cwd ? { cwd } : {}),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

export async function assertCodexSentinelUnchanged(
  paths: CodexInstallPaths,
  expected: CodexSentinel | null,
): Promise<void> {
  const current = await readSentinel(paths.sentinelPath);
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error("Codex ownership sentinel changed during lifecycle preparation");
  }
}

interface CodexExplicitFileState {
  present: boolean;
  hash: string | null;
  bytes?: Uint8Array;
  mode?: number;
}

interface CodexExplicitStateSnapshot {
  globalInstructions: CodexExplicitFileState;
  config: CodexExplicitFileState;
}

async function captureCodexExplicitFileState(path: string): Promise<CodexExplicitFileState> {
  const metadata = await lstatOrNull(path);
  if (!metadata) return { present: false, hash: null };
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Codex explicit state is not a regular file: ${path}`);
  }
  const bytes = await readFile(path);
  return {
    present: true,
    hash: contentHash(bytes),
    bytes,
    mode: metadata.mode & 0o777,
  };
}

export async function captureCodexExplicitState(
  paths: CodexInstallPaths,
): Promise<CodexExplicitStateSnapshot> {
  const [globalInstructions, config] = await Promise.all([
    captureCodexExplicitFileState(paths.globalInstructionsPath),
    captureCodexExplicitFileState(paths.configPath),
  ]);
  return { globalInstructions, config };
}

export async function refreshOperationOwnedInstructions(
  paths: CodexInstallPaths,
  snapshot: CodexExplicitStateSnapshot,
): Promise<CodexExplicitStateSnapshot> {
  return {
    ...snapshot,
    globalInstructions: await captureCodexExplicitFileState(paths.globalInstructionsPath),
  };
}

export async function assertCodexExplicitStateUnchanged(
  paths: CodexInstallPaths,
  expected: CodexExplicitStateSnapshot,
): Promise<void> {
  const current = await captureCodexExplicitState(paths);
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error("Codex AGENTS.md or config.toml changed during lifecycle preparation");
  }
}

function codexExplicitFileStateMatches(
  left: CodexExplicitFileState,
  right: CodexExplicitFileState,
): boolean {
  return left.present === right.present && left.hash === right.hash;
}

export interface CodexExplicitStateDrift {
  globalInstructions?: CodexExplicitFileState;
  config?: CodexExplicitFileState;
}

export async function captureCodexExplicitStateDrift(
  paths: CodexInstallPaths,
  expected: CodexExplicitStateSnapshot,
): Promise<CodexExplicitStateDrift> {
  const current = await captureCodexExplicitState(paths);
  return {
    ...(codexExplicitFileStateMatches(current.globalInstructions, expected.globalInstructions)
      ? {}
      : { globalInstructions: current.globalInstructions }),
    ...(codexExplicitFileStateMatches(current.config, expected.config)
      ? {}
      : { config: current.config }),
  };
}

export async function restoreCodexExplicitStateDrift(
  paths: CodexInstallPaths,
  drift: CodexExplicitStateDrift,
): Promise<void> {
  for (const [path, state] of [
    [paths.globalInstructionsPath, drift.globalInstructions],
    [paths.configPath, drift.config],
  ] as const) {
    if (!state) continue;
    await rm(path, { recursive: true, force: true });
    if (!state.present || state.bytes === undefined || state.mode === undefined) continue;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, state.bytes);
    await chmod(path, state.mode);
  }
}
