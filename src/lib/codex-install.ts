import { existsSync, type Stats } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { parseFrontmatter } from "./frontmatter.ts";
import { readJsonOrNull } from "./json-io.ts";
import { formatLegacyCodexSkillOverlap, scanLegacyCodexSkills } from "./managed-skills.ts";
import { getTimestamp, sha256, whichCommand } from "./platform.ts";
import { compareVersion } from "./version-delta.ts";

const INSTRUCTIONS_START = "<!-- cc-settings:codex:start -->";
const INSTRUCTIONS_END = "<!-- cc-settings:codex:end -->";
const SENTINEL_NAME = ".cc-settings-version";
const MANAGED_RULE_NAME = "darkroom.rules";
const MAX_BACKUPS = 10;
const MANAGED_AGENT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHARED_BACKUP_ID = /^\d{14}-\d{3}-\d+-\d+$/;
const STRICT_VERSION = /^\d+\.\d+\.\d+$/;
const RETIRED_MANAGED_AGENT_NAMES = new Set<string>();
const MANAGED_AGENT_SOURCE_FILES = [
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
const EXCLUDED_AGENT_SOURCE_FILES = new Set(["codex-verifier.md"]);
const CODEX_ADAPTER = `Native Codex adapter:
- Treat Claude tool names in this shared source as capability names, not literal calls. Inspect and search with exec_command plus rg; edit with apply_patch.
- Delegate with spawn_agent. Use followup_task to trigger another turn for an idle existing agent, send_message to deliver context to a running agent, wait_agent to wait, and interrupt_agent to stop its current turn when necessary.
- Treat Agent as spawn_agent and AskUserQuestion as reporting the blocking question to the parent agent. Agent lifecycle APIs can vary by host, so prefer these capabilities over guessed aliases.
- Follow AGENTS.md for repository instructions. Claude-specific output styles, status lines, agent teams, and worktree isolation are unavailable unless the active Codex surface explicitly exposes an equivalent; serialize file-writing agents when isolation is unavailable.
- Do not invoke codex-verifier or codex-run.ts from inside Codex. Claude-only helper paths and the tldr binary are optional; use native Codex tools when they are absent.`;

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

interface CodexSentinel {
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

interface BackupManifest {
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

interface CodexPluginState {
  pluginInstalled: boolean;
  pluginEnabled: boolean;
  marketplaceEnrolled: boolean;
  pluginSource: string | null;
  marketplaceSource: string | null;
}

interface BackupPluginState extends CodexPluginState {
  restoreMode: "managed-restorable" | "independent-preserve-only";
}

/** Drop `restoreMode` to compare a backup's recorded plugin state against a
 *  live `CodexPluginState` reading. */
function toPluginState(state: BackupPluginState): CodexPluginState {
  return {
    pluginInstalled: state.pluginInstalled,
    pluginEnabled: state.pluginEnabled,
    marketplaceEnrolled: state.marketplaceEnrolled,
    pluginSource: state.pluginSource,
    marketplaceSource: state.marketplaceSource,
  };
}

interface NativeAgent {
  name: string;
  description: string;
  developerInstructions: string;
  modelReasoningEffort?: "low" | "medium" | "high" | "xhigh";
  sandboxMode: "read-only" | "workspace-write";
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function errorDetail(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

/** `lstat`, treating a missing path as `null` instead of throwing ENOENT. */
async function lstatOrNull(path: string): Promise<Stats | null> {
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

async function assertCodexBoundaries(paths: CodexInstallPaths): Promise<void> {
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

async function assertManagedAgentBoundaries(
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function validatedAgentNames(value: unknown, source: string): string[] {
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
  if (!isRecord(value)) throw new Error(`Invalid managed agent hashes in ${source}`);
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

async function readSentinel(path: string): Promise<CodexSentinel | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(value)) throw new Error(`Invalid Codex sentinel: ${path}`);
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
    if (managedSourceHashes !== undefined && !isRecord(managedSourceHashes)) {
      throw new Error(`Invalid managed source hashes in ${path}`);
    }
    const sourceHashes: Record<string, string> = {};
    if (isRecord(managedSourceHashes)) {
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

function instructionsBlock(repoAgents: string, codexAppend: string): string {
  const body = `${repoAgents.trimEnd()}\n\n${codexAppend.trim()}\n`;
  return `${INSTRUCTIONS_START}\n${body}${INSTRUCTIONS_END}`;
}

function managedBlockRange(text: string): { start: number; end: number } | null {
  const markerIndexes = (marker: string): number[] => {
    const indexes: number[] = [];
    let cursor = 0;
    while (true) {
      const index = text.indexOf(marker, cursor);
      if (index === -1) return indexes;
      indexes.push(index);
      cursor = index + marker.length;
    }
  };
  const starts = markerIndexes(INSTRUCTIONS_START);
  const ends = markerIndexes(INSTRUCTIONS_END);
  if (starts.length === 0 && ends.length === 0) return null;
  if (starts.length !== 1 || ends.length !== 1 || (starts[0] as number) > (ends[0] as number)) {
    throw new Error(`Malformed ${basename("AGENTS.md")}: invalid managed marker topology`);
  }
  return { start: starts[0] as number, end: (ends[0] as number) + INSTRUCTIONS_END.length };
}

function mergeInstructions(existing: string, block: string): string {
  const range = managedBlockRange(existing);
  if (range) return `${existing.slice(0, range.start)}${block}${existing.slice(range.end)}`;
  if (existing.length === 0) return `${block}\n`;
  return `${existing}\n${block}\n`;
}

function removeInstructions(existing: string): string {
  const range = managedBlockRange(existing);
  if (!range) return existing;
  const start =
    range.start > 0 && existing[range.start - 1] === "\n" ? range.start - 1 : range.start;
  let end = range.end;
  if (existing.slice(end, end + 2) === "\r\n") end += 2;
  else if (existing[end] === "\n") end++;
  return `${existing.slice(0, start)}${existing.slice(end)}`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function serializeNativeAgent(agent: NativeAgent, paths: CodexInstallPaths): string {
  const managedSrc = join(paths.managedSource, "src");
  const developerInstructions = agent.developerInstructions
    .replaceAll("$HOME/.claude/src", managedSrc)
    .replaceAll("~/.claude/src", managedSrc)
    .replaceAll("~/.claude/CLAUDE.md", paths.globalInstructionsPath)
    .replaceAll("CLAUDE.md", "AGENTS.md");
  const fields = [
    `name = ${tomlString(agent.name)}`,
    `description = ${tomlString(agent.description)}`,
    `developer_instructions = ${tomlString(developerInstructions)}`,
    ...(agent.modelReasoningEffort
      ? [`model_reasoning_effort = ${tomlString(agent.modelReasoningEffort)}`]
      : []),
    `sandbox_mode = ${tomlString(agent.sandboxMode)}`,
  ];
  const output = `${fields.join("\n")}\n`;
  Bun.TOML.parse(output);
  return output;
}

function markdownBody(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  if (!match) throw new Error("Agent file has no parseable frontmatter block");
  return markdown.slice(match[0].length).trim();
}

async function loadNativeAgents(sourceDir: string): Promise<NativeAgent[]> {
  const dir = join(sourceDir, "agents");
  const directoryMetadata = await lstat(dir);
  if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory()) {
    throw new Error("Codex source agents path is not a safe directory");
  }
  const allowedEntries = new Set<string>([
    ...MANAGED_AGENT_SOURCE_FILES,
    ...EXCLUDED_AGENT_SOURCE_FILES,
  ]);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!allowedEntries.has(entry.name) || !entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Unexpected Codex agent source artifact: agents/${entry.name}`);
    }
  }
  const agents: NativeAgent[] = [];
  for (const entry of MANAGED_AGENT_SOURCE_FILES) {
    await assertRuntimeSourceFile(sourceDir, `agents/${entry}`);
    const markdown = await readFile(join(dir, entry), "utf8");
    const parsed = parseFrontmatter(markdown);
    if (!isRecord(parsed)) throw new Error(`Cannot convert agents/${entry}: invalid frontmatter`);
    const fallbackName = entry.slice(0, -3);
    const name = typeof parsed.name === "string" ? parsed.name : fallbackName;
    const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
    if (!name || !description) {
      throw new Error(`Cannot convert agents/${entry}: name and description are required`);
    }
    if (!MANAGED_AGENT_NAME.test(name)) {
      throw new Error(`Cannot convert agents/${entry}: unsafe agent name ${name}`);
    }
    if (name !== fallbackName) {
      throw new Error(`Cannot convert agents/${entry}: name must be ${fallbackName}`);
    }
    const tools = stringArray(parsed.tools);
    const effort = parsed.effort;
    const modelReasoningEffort =
      effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh"
        ? effort
        : effort === "max"
          ? "xhigh"
          : undefined;
    agents.push({
      name,
      description,
      developerInstructions: `${markdownBody(markdown)}\n\n${CODEX_ADAPTER}`,
      ...(modelReasoningEffort ? { modelReasoningEffort } : {}),
      sandboxMode:
        tools.includes("Write") || tools.includes("Edit") ? "workspace-write" : "read-only",
    });
  }
  return agents;
}

async function shippedNativeAgentNames(): Promise<Set<string>> {
  return new Set([
    ...MANAGED_AGENT_SOURCE_FILES.map((entry) => entry.slice(0, -3)),
    ...RETIRED_MANAGED_AGENT_NAMES,
  ]);
}

function assertBoundedAgentNames(
  names: string[],
  allowedNames: ReadonlySet<string>,
  source: string,
): void {
  const invalid = names.filter((name) => !allowedNames.has(name));
  if (invalid.length > 0) {
    throw new Error(`Unowned managed agent names in ${source}: ${invalid.join(", ")}`);
  }
}

function assertSentinelAgentOwnership(
  sentinel: CodexSentinel | null,
  allowedNames: ReadonlySet<string>,
  source: string,
): void {
  if (!sentinel) return;
  assertBoundedAgentNames(sentinel.managed_agents, allowedNames, source);
  const actualNames = [...sentinel.managed_agents].sort();
  if (new Set(actualNames).size !== actualNames.length) {
    throw new Error(`Incomplete managed agent ownership in ${source}`);
  }
  if (sentinel.profile === "light" && actualNames.length !== 0) {
    throw new Error(`Light Codex sentinel claims managed agents in ${source}`);
  }
  if (sentinel.profile === "full" && actualNames.length === 0) {
    throw new Error(`Incomplete managed agent ownership in ${source}`);
  }
  if (sentinel.profile === "full" && !sentinel.managed_rule_hash) {
    throw new Error(`Incomplete managed rule ownership in ${source}`);
  }
  if (sentinel.profile === "light" && sentinel.managed_rule_hash) {
    throw new Error(`Light Codex sentinel claims a managed rule in ${source}`);
  }
  const sourceHashes = sentinel.managed_source_hashes ?? {};
  const sourcePaths = Object.keys(sourceHashes).sort();
  const expectedSourcePaths = [
    ...runtimePathsForVersion(sentinel.runtime_manifest_version, source),
  ].sort();
  if (
    JSON.stringify(sourcePaths) !== JSON.stringify(expectedSourcePaths) ||
    expectedSourcePaths.some((path) => !SHA256.test(sourceHashes[path] ?? "")) ||
    !sentinel.managed_instructions_hash
  ) {
    throw new Error(
      `Incomplete Codex source/instructions ownership in ${source}. Reinstall cc-settings once to establish complete hash ownership.`,
    );
  }
  const hashes = sentinel.managed_agent_hashes ?? {};
  const hashNames = Object.keys(hashes).sort();
  if (
    JSON.stringify(hashNames) !== JSON.stringify(actualNames) ||
    actualNames.some((name) => !SHA256.test(hashes[name] ?? ""))
  ) {
    throw new Error(`Incomplete managed agent hashes in ${source}`);
  }
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

const REQUIRED_SOURCE_ARTIFACTS = [
  "AGENTS.md",
  "codex/AGENTS.append.md",
  "codex/rules/darkroom.rules",
  ".claude-plugin/marketplace.json",
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "hooks/hooks.json",
  "agents",
  "skills",
  "src",
  "package.json",
  "bun.lock",
  "tsconfig.json",
] as const;

// The managed plugin is a release artifact, not a checkout mirror. Keep this
// list explicit so ignored or user-created descendants can never enter the
// installed runtime merely because they live below skills/ or src/.
const RUNTIME_SOURCE_FILES = [
  ".claude-plugin/marketplace.json",
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "bun.lock",
  "hooks/README.md",
  "hooks/checkpoint.md",
  "hooks/hooks.json",
  "hooks/verification-check.md",
  "package.json",
  "skills/README.md",
  "skills/adhd/SKILL.md",
  "skills/audit/SKILL.md",
  "skills/audit/references/audit-contract.md",
  "skills/audit/references/nuclear-review.workflow.js",
  "skills/audit/references/seo-checks.md",
  "skills/autoresearch/SKILL.md",
  "skills/build/SKILL.md",
  "skills/cc/SKILL.md",
  "skills/checkpoint/SKILL.md",
  "skills/codex/SKILL.md",
  "skills/codex/agents/openai.yaml",
  "skills/component/SKILL.md",
  "skills/consolidate/SKILL.md",
  "skills/context-doc/ADR-FORMAT.md",
  "skills/context-doc/CONTEXT-FORMAT.md",
  "skills/context-doc/DOMAIN-AWARENESS.md",
  "skills/context-doc/SKILL.md",
  "skills/design-tokens/SKILL.md",
  "skills/dr-init/SKILL.md",
  "skills/explore/SKILL.md",
  "skills/fix/SKILL.md",
  "skills/freeze/SKILL.md",
  "skills/handoff/SKILL.md",
  "skills/harvest/CONTRACT.md",
  "skills/harvest/SKILL.md",
  "skills/hook/SKILL.md",
  "skills/lighthouse/SKILL.md",
  "skills/lighthouse/agents/openai.yaml",
  "skills/oracle/SKILL.md",
  "skills/orchestrate/SKILL.md",
  "skills/plan-ceo-review/SKILL.md",
  "skills/plan-feature/SKILL.md",
  "skills/project/SKILL.md",
  "skills/proof-of-work/SKILL.md",
  "skills/qa/SKILL.md",
  "skills/qa/agents/openai.yaml",
  "skills/refactor/SKILL.md",
  "skills/retro/SKILL.md",
  "skills/review-batch/SKILL.md",
  "skills/review/SKILL.md",
  "skills/share-learning/SKILL.md",
  "skills/ship/SKILL.md",
  "skills/strategist/SKILL.md",
  "skills/test/SKILL.md",
  "skills/tldr/SKILL.md",
  "skills/triage/SKILL.md",
  "skills/verify/SKILL.md",
  "skills/zero-tech-debt/SKILL.md",
  "src/codemap/callgraph.ts",
  "src/codemap/change-impact.ts",
  "src/codemap/cli.ts",
  "src/codemap/imports.ts",
  "src/codemap/index.ts",
  "src/codemap/mcp-server.ts",
  "src/codemap/program.ts",
  "src/codemap/structure.ts",
  "src/codemap/tools.ts",
  "src/codemap/types.ts",
  "src/hooks/codex-verify.ts",
  "src/hooks/delegation-detector.ts",
  "src/hooks/escalate-acted.ts",
  "src/hooks/escalate-model.ts",
  "src/hooks/freeze-guard.ts",
  "src/hooks/pre-commit-farolero.ts",
  "src/hooks/pre-edit-validate.ts",
  "src/hooks/pre-pr-proof.ts",
  "src/hooks/pre-push-proof.ts",
  "src/hooks/promote-memory.ts",
  "src/hooks/quota-steer.ts",
  "src/hooks/safety-net.ts",
  "src/hooks/statusline.ts",
  "src/hooks/tool-cadence.ts",
  "src/hooks/verify-hooks.ts",
  "src/lib/artifact-store.ts",
  "src/lib/audit-hooks.ts",
  "src/lib/cli-preflight.ts",
  "src/lib/claude-managed-file-manifests.ts",
  "src/lib/claude-managed-files.ts",
  "src/lib/code-intel-engine.ts",
  "src/lib/codex-install.ts",
  "src/lib/codex.ts",
  "src/lib/colors.ts",
  "src/lib/compose-settings.ts",
  "src/lib/download-verify.ts",
  "src/lib/engine-pin.ts",
  "src/lib/escalate-telemetry.ts",
  "src/lib/escalate.ts",
  "src/lib/freeze.ts",
  "src/lib/frontmatter-validate.ts",
  "src/lib/frontmatter.ts",
  "src/lib/git.ts",
  "src/lib/hook-command.ts",
  "src/lib/hook-config.ts",
  "src/lib/hook-runtime.ts",
  "src/lib/hooks-fingerprint.ts",
  "src/lib/install-cmds.ts",
  "src/lib/install-display.ts",
  "src/lib/install-fs.ts",
  "src/lib/install-lock.ts",
  "src/lib/json-io.ts",
  "src/lib/knowledge-index.ts",
  "src/lib/light-profile.ts",
  "src/lib/lint-agents.ts",
  "src/lib/lint-frontmatter.ts",
  "src/lib/lint-knowledge.ts",
  "src/lib/lint-links.ts",
  "src/lib/lint-profiles.ts",
  "src/lib/lint-research.ts",
  "src/lib/lint-shortcuts.ts",
  "src/lib/lint-skills.ts",
  "src/lib/managed-paths.ts",
  "src/lib/managed-skills.ts",
  "src/lib/mcp.ts",
  "src/lib/merge-keyed.ts",
  "src/lib/packages.ts",
  "src/lib/permissions-check.ts",
  "src/lib/permissions-doc.ts",
  "src/lib/pinned-tools.ts",
  "src/lib/platform.ts",
  "src/lib/problem-signature.ts",
  "src/lib/project-awareness.ts",
  "src/lib/prompts.ts",
  "src/lib/proof-of-work.ts",
  "src/lib/quota.ts",
  "src/lib/redact.ts",
  "src/lib/review-queue.ts",
  "src/lib/schedule.ts",
  "src/lib/session-ledger.ts",
  "src/lib/session-model.ts",
  "src/lib/settings-baseline.ts",
  "src/lib/settings-merge.ts",
  "src/lib/skill-prereqs.ts",
  "src/lib/status-types.ts",
  "src/lib/status.ts",
  "src/lib/team-knowledge.ts",
  "src/lib/tsc.ts",
  "src/lib/version-delta.ts",
  "src/schemas/agent.ts",
  "src/schemas/claude-json.ts",
  "src/schemas/emit.ts",
  "src/schemas/hooks.ts",
  "src/schemas/knowledge.ts",
  "src/schemas/mcp.ts",
  "src/schemas/permissions.ts",
  "src/schemas/profile.ts",
  "src/schemas/settings.ts",
  "src/schemas/skill.ts",
  "src/scripts/audit-hooks.ts",
  "src/scripts/auto-update.ts",
  "src/scripts/check-cli-tools.ts",
  "src/scripts/check-docs-before-install.ts",
  "src/scripts/checkpoint.ts",
  "src/scripts/claude-audit.ts",
  "src/scripts/codex-hook.ts",
  "src/scripts/codex-run.ts",
  "src/scripts/cwd-changed.ts",
  "src/scripts/escalate-stats.ts",
  "src/scripts/freeze.ts",
  "src/scripts/gen-permissions-doc.ts",
  "src/scripts/handoff.ts",
  "src/scripts/ledger-record.ts",
  "src/scripts/lint-agents.ts",
  "src/scripts/lint-knowledge.ts",
  "src/scripts/lint-links.ts",
  "src/scripts/lint-profiles.ts",
  "src/scripts/lint-research.ts",
  "src/scripts/lint-shortcuts.ts",
  "src/scripts/lint-skills.ts",
  "src/scripts/log-bash.ts",
  "src/scripts/migrate-legacy-codex-skills.ts",
  "src/scripts/new-note.ts",
  "src/scripts/new-skill.ts",
  "src/scripts/notify.ts",
  "src/scripts/permissions-check.ts",
  "src/scripts/post-compact.ts",
  "src/scripts/post-edit-tsc.ts",
  "src/scripts/post-edit.ts",
  "src/scripts/post-failure.ts",
  "src/scripts/pre-commit-tsc.ts",
  "src/scripts/project-init.ts",
  "src/scripts/proof.ts",
  "src/scripts/prune-mcp-auth-cache.ts",
  "src/scripts/refresh-knowledge-index.ts",
  "src/scripts/review-batch.ts",
  "src/scripts/session-start.ts",
  "src/scripts/session-title.ts",
  "src/scripts/stop-failure.ts",
  "src/scripts/stop-summary.ts",
  "src/scripts/swarm-log.ts",
  "src/scripts/whats-on.ts",
  "src/setup.ts",
  "src/upstream/scan.ts",
  "tsconfig.json",
] as const;

// Version 1 predates the shared Claude managed-file ownership helper. Keep the
// exact historical path set so an update can validate and back up that older
// runtime without deriving its ownership from today's checkout.
const RUNTIME_SOURCE_FILES_V1 = RUNTIME_SOURCE_FILES.filter(
  (path) =>
    path !== "src/lib/claude-managed-files.ts" &&
    path !== "src/lib/claude-managed-file-manifests.ts",
);
const RUNTIME_SOURCE_FILES_V2 = RUNTIME_SOURCE_FILES.filter(
  (path) => path !== "src/lib/claude-managed-file-manifests.ts",
);
const RUNTIME_SOURCE_FILES_V3 = RUNTIME_SOURCE_FILES.filter(
  (path) => path !== "src/scripts/migrate-legacy-codex-skills.ts",
);
const CURRENT_RUNTIME_MANIFEST_VERSION = 4;
const SUPPORTED_RUNTIME_MANIFESTS = new Map<number, readonly string[]>([
  [1, RUNTIME_SOURCE_FILES_V1],
  [2, RUNTIME_SOURCE_FILES_V2],
  [3, RUNTIME_SOURCE_FILES_V3],
  [CURRENT_RUNTIME_MANIFEST_VERSION, RUNTIME_SOURCE_FILES],
]);

function runtimePathsForVersion(value: unknown, source: string): readonly string[] {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(
      `Missing Codex runtime manifest version in ${source}. Reinstall cc-settings once to establish versioned ownership.`,
    );
  }
  const paths = SUPPORTED_RUNTIME_MANIFESTS.get(value);
  if (!paths) {
    throw new Error(`Unsupported Codex runtime manifest version ${value} in ${source}`);
  }
  return paths;
}

async function assertRuntimeSourceFile(sourceDir: string, label: string): Promise<void> {
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

async function copyRuntimeManifest(
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

async function runtimeManifestHashes(
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

async function assertPreviousManagedContentUnmodified(
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

async function preflightCodexSource(sourceDir: string): Promise<NativeAgent[]> {
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

function backupRelativePath(path: string, paths: CodexInstallPaths): string {
  return relative(paths.codexHome, path);
}

async function copyIfPresent(source: string, destination: string): Promise<boolean> {
  if (!existsSync(source)) return false;
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
  return true;
}

function contentHash(content: string | Uint8Array): string {
  return sha256(content);
}

async function regularFileHash(path: string): Promise<string | null> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile()) return null;
    return contentHash(await readFile(path));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

async function removeFileWithHash(
  path: string,
  expectedHash: string | undefined,
): Promise<boolean> {
  if (!expectedHash || (await regularFileHash(path)) !== expectedHash) return false;
  await rm(path, { force: true });
  return true;
}

async function createCodexBackup(
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

async function prepareManagedSource(
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

async function installPreparedManagedSource(
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

async function runCommand(
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

function nestedString(value: unknown, objectKey: string, stringKey: string): string | null {
  if (!isRecord(value)) return null;
  const nested = value[objectKey];
  return isRecord(nested) && typeof nested[stringKey] === "string" ? nested[stringKey] : null;
}

function parsePluginList(stdout: string): {
  installed: boolean;
  enabled: boolean;
  source: string | null;
} {
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed) || !Array.isArray(parsed.installed)) {
    throw new Error("Invalid Codex plugin list response");
  }
  const matches = parsed.installed.filter(
    (item) =>
      isRecord(item) &&
      (item.pluginId === "darkroom@cc-settings" ||
        (item.name === "darkroom" && item.marketplaceName === "cc-settings")),
  );
  if (matches.length > 1) throw new Error("Ambiguous darkroom Codex plugin state");
  const match = matches[0];
  if (!match) return { installed: false, enabled: false, source: null };
  if (typeof match.installed !== "boolean" || typeof match.enabled !== "boolean") {
    throw new Error("Incomplete darkroom Codex plugin state");
  }
  if (match.enabled && !match.installed) throw new Error("Invalid darkroom Codex plugin state");
  const source =
    nestedString(match, "source", "path") ?? nestedString(match, "marketplaceSource", "source");
  if (match.installed && source === null) {
    throw new Error("Darkroom Codex plugin state is missing source provenance");
  }
  return { installed: match.installed, enabled: match.enabled, source };
}

function parseMarketplaceList(stdout: string): { enrolled: boolean; source: string | null } {
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed) || !Array.isArray(parsed.marketplaces)) {
    throw new Error("Invalid Codex marketplace list response");
  }
  const matches = parsed.marketplaces.filter(
    (item) => isRecord(item) && item.name === "cc-settings",
  );
  if (matches.length > 1) throw new Error("Ambiguous cc-settings Codex marketplace state");
  const match = matches[0];
  if (!isRecord(match)) return { enrolled: false, source: null };
  const source =
    nestedString(match, "marketplaceSource", "source") ??
    (typeof match.root === "string" ? match.root : null);
  if (source === null)
    throw new Error("cc-settings marketplace state is missing source provenance");
  return { enrolled: true, source };
}

async function canonicalPluginSource(path: string, label: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`${label} is not an absolute path: ${path}`);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${label} is not a safe directory: ${path}`);
  }
  return await realpath(path);
}

async function canonicalManagedSourcePath(paths: CodexInstallPaths): Promise<string> {
  const codexRoot = await realpath(paths.codexHome).catch(() => resolve(paths.codexHome));
  return join(codexRoot, relative(paths.codexHome, paths.managedSource));
}

async function readCodexPluginState(paths: CodexInstallPaths): Promise<CodexPluginState | null> {
  if (isCodexCliSkippedForTests() || !codexCliAvailable()) return null;
  const plugins = await runCommand(["codex", "plugin", "list", "--json"], paths.codexHome);
  if (plugins.exitCode !== 0) {
    throw new Error(
      `Codex plugin state query failed: ${(plugins.stderr || plugins.stdout).trim()}`,
    );
  }
  const plugin = parsePluginList(plugins.stdout);
  const marketplaces = await runCommand(
    ["codex", "plugin", "marketplace", "list", "--json"],
    paths.codexHome,
  );
  if (marketplaces.exitCode !== 0) {
    throw new Error(
      `Codex marketplace state query failed: ${(marketplaces.stderr || marketplaces.stdout).trim()}`,
    );
  }
  const marketplace = parseMarketplaceList(marketplaces.stdout);
  const pluginSource = plugin.source
    ? await canonicalPluginSource(plugin.source, "Codex plugin source")
    : null;
  const marketplaceSource = marketplace.source
    ? await canonicalPluginSource(marketplace.source, "Codex marketplace source")
    : null;
  return {
    pluginInstalled: plugin.installed,
    pluginEnabled: plugin.enabled,
    marketplaceEnrolled: marketplace.enrolled,
    pluginSource,
    marketplaceSource,
  };
}

async function assertManagedPluginProvenance(
  paths: CodexInstallPaths,
  sentinel: CodexSentinel | null,
  state: CodexPluginState | null,
): Promise<void> {
  if (sentinel?.profile !== "full" || !state) return;
  const managedSource = await canonicalPluginSource(
    paths.managedSource,
    "Managed Codex plugin source",
  );
  if (state.marketplaceEnrolled && state.marketplaceSource !== managedSource) {
    throw new Error("Managed cc-settings Codex marketplace was repointed to an unowned source");
  }
  if (
    state.pluginInstalled &&
    !(await isManagedPluginSource(paths, managedSource, state.pluginSource))
  ) {
    throw new Error("Managed darkroom Codex plugin was repointed to an unowned source");
  }
}

async function isManagedPluginSource(
  paths: CodexInstallPaths,
  managedSource: string,
  pluginSource: string | null,
): Promise<boolean> {
  if (!pluginSource) return false;
  if (pluginSource === managedSource || pluginSource === join(managedSource, ".codex-plugin")) {
    return true;
  }
  const cacheRootPath = join(paths.codexHome, "plugins", "cache", "cc-settings");
  const cacheRoot = await realpath(cacheRootPath).catch(() => null);
  if (!cacheRoot) return false;
  const fromCache = relative(cacheRoot, pluginSource);
  return Boolean(
    fromCache && fromCache !== ".." && !fromCache.startsWith(`..${sep}`) && !isAbsolute(fromCache),
  );
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

async function installPlugin(paths: CodexInstallPaths): Promise<void> {
  if (isCodexCliSkippedForTests()) return;
  await addMarketplace(paths, paths.managedSource);
  await addManagedPlugin(paths);
  const installed = await readCodexPluginState(paths);
  const expectedSource = await canonicalManagedSourcePath(paths);
  if (
    !installed?.pluginInstalled ||
    !installed.pluginEnabled ||
    !installed.marketplaceEnrolled ||
    installed.marketplaceSource !== expectedSource ||
    !(await isManagedPluginSource(paths, expectedSource, installed.pluginSource))
  ) {
    throw new Error(
      "Codex plugin commands reported success without installing the enabled managed plugin and marketplace provenance",
    );
  }
}

async function runPluginCommand(paths: CodexInstallPaths, command: string[]): Promise<void> {
  const result = await runCommand(command, paths.codexHome);
  if (result.exitCode !== 0) {
    throw new Error(
      `Codex plugin command failed (${command.join(" ")}): ${(result.stderr || result.stdout).trim()}`,
    );
  }
}

async function addMarketplace(paths: CodexInstallPaths, source: string): Promise<void> {
  await runPluginCommand(paths, ["codex", "plugin", "marketplace", "add", source, "--json"]);
}

async function addManagedPlugin(paths: CodexInstallPaths): Promise<void> {
  await runPluginCommand(paths, ["codex", "plugin", "add", "darkroom@cc-settings", "--json"]);
}

async function removePluginCommand(
  paths: CodexInstallPaths,
  command: string[],
  identity: string,
): Promise<void> {
  const result = await runCommand(command, paths.codexHome);
  if (result.exitCode === 0) return;
  const detail = `${result.stdout}\n${result.stderr}`;
  const identityAbsent =
    detail.includes(identity) &&
    /not found|not installed|not configured or installed|unknown marketplace/i.test(detail);
  if (identityAbsent) return;
  throw new Error(`Codex plugin removal failed (${command.join(" ")}): ${detail.trim()}`);
}

async function removeMarketplace(paths: CodexInstallPaths): Promise<void> {
  await removePluginCommand(
    paths,
    ["codex", "plugin", "marketplace", "remove", "cc-settings", "--json"],
    "cc-settings",
  );
}

async function restorePluginState(
  paths: CodexInstallPaths,
  state: BackupPluginState | null,
): Promise<void> {
  if (state === null) return;
  if (isCodexCliSkippedForTests() || !codexCliAvailable()) {
    if (!state.pluginInstalled && !state.marketplaceEnrolled) return;
    throw new Error(
      "Cannot restore recorded Codex plugin state because the Codex CLI is unavailable",
    );
  }
  if (state.restoreMode === "independent-preserve-only") {
    const current = await readCodexPluginState(paths);
    const expectedState = toPluginState(state);
    if (JSON.stringify(current) === JSON.stringify(expectedState)) return;
    if (state.pluginInstalled || state.marketplaceEnrolled) {
      throw new Error(
        "Cannot recreate independently managed Codex plugin state because its backup provenance is preserve-only. Restore it manually, then retry rollback.",
      );
    }
    if (current?.pluginInstalled || current?.marketplaceEnrolled) {
      const expected = await canonicalManagedSourcePath(paths);
      if (
        (current.marketplaceEnrolled && current.marketplaceSource !== expected) ||
        (current.pluginInstalled &&
          !(await isManagedPluginSource(paths, expected, current.pluginSource)))
      ) {
        throw new Error("Cannot remove independently managed Codex plugin state during rollback");
      }
      await removePlugin(paths, true);
    }
    return;
  }
  let managedSource: string | null = null;
  if (state.marketplaceEnrolled || state.pluginInstalled) {
    if (!state.marketplaceSource) {
      throw new Error("Cannot restore Codex marketplace state without its recorded source");
    }
    const expected = await canonicalManagedSourcePath(paths);
    if (
      state.marketplaceSource !== expected ||
      (state.pluginInstalled && !(await isManagedPluginSource(paths, expected, state.pluginSource)))
    ) {
      throw new Error("Cannot execute an unowned Codex plugin source from backup metadata");
    }
    managedSource = state.marketplaceSource;
  }
  await removePlugin(paths, true);
  if (managedSource) await addMarketplace(paths, managedSource);
  if (state.pluginInstalled) await addManagedPlugin(paths);
  if (!state.marketplaceEnrolled && state.pluginInstalled) await removeMarketplace(paths);
}

async function restorePluginStateAndConfig(
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

async function removePlugin(paths: CodexInstallPaths, required = false): Promise<void> {
  if (isCodexCliSkippedForTests()) return;
  if (!codexCliAvailable()) {
    if (required) {
      throw new Error("Codex CLI is required to remove managed plugin or marketplace state");
    }
    return;
  }
  await removePluginCommand(
    paths,
    ["codex", "plugin", "remove", "darkroom@cc-settings", "--json"],
    "darkroom@cc-settings",
  );
  await removeMarketplace(paths);
}

async function writeManagedInstructions(
  sourceDir: string,
  paths: CodexInstallPaths,
): Promise<string> {
  const [repoAgents, codexAppend, existing] = await Promise.all([
    readFile(join(sourceDir, "AGENTS.md"), "utf8"),
    readFile(join(sourceDir, "codex", "AGENTS.append.md"), "utf8"),
    readFile(paths.globalInstructionsPath, "utf8").catch(() => ""),
  ]);
  await mkdir(dirname(paths.globalInstructionsPath), { recursive: true });
  const merged = mergeInstructions(existing, instructionsBlock(repoAgents, codexAppend));
  await writeFile(paths.globalInstructionsPath, merged);
  const range = managedBlockRange(merged);
  if (!range) throw new Error("Managed Codex instructions block was not written");
  return contentHash(merged.slice(range.start, range.end));
}

async function removeAgentFiles(
  paths: CodexInstallPaths,
  names: string[],
  hashes: Record<string, string> | undefined,
): Promise<void> {
  for (const name of new Set(names)) {
    if (!MANAGED_AGENT_NAME.test(name)) throw new Error(`Unsafe managed agent name: ${name}`);
    await removeFileWithHash(join(paths.agentsDir, `${name}.toml`), hashes?.[name]);
  }
}

async function assertNoNativeCollisions(
  paths: CodexInstallPaths,
  names: string[],
  previous: CodexSentinel | null,
): Promise<void> {
  const previouslyManaged = new Set(previous?.managed_agents ?? []);
  const agentConflicts: string[] = [];
  for (const name of names) {
    const path = join(paths.agentsDir, `${name}.toml`);
    const currentHash = await regularFileHash(path);
    if (currentHash === null) continue;
    const ownedHash = previous?.managed_agent_hashes?.[name];
    if (!previouslyManaged.has(name) || !ownedHash || currentHash !== ownedHash) {
      agentConflicts.push(name);
    }
  }
  const rulePath = join(paths.rulesDir, MANAGED_RULE_NAME);
  const currentRuleHash = await regularFileHash(rulePath);
  const ruleConflict =
    currentRuleHash !== null &&
    (!previous?.managed_rule_hash || currentRuleHash !== previous.managed_rule_hash);
  const conflicts = [
    ...agentConflicts.map((name) => join(paths.agentsDir, `${name}.toml`)),
    ...(ruleConflict ? [join(paths.rulesDir, MANAGED_RULE_NAME)] : []),
  ];
  if (conflicts.length > 0) {
    throw new Error(
      `Codex install would overwrite files not owned by cc-settings: ${conflicts.join(", ")}. ` +
        "Back up and remove these files to let the native install claim their names, " +
        "or install Claude only with --target=claude.",
    );
  }
}

async function assertInstructionsMergeable(paths: CodexInstallPaths): Promise<void> {
  if (!existsSync(paths.globalInstructionsPath)) return;
  managedBlockRange(await readFile(paths.globalInstructionsPath, "utf8"));
}

async function assertCodexSentinelUnchanged(
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

async function captureCodexExplicitState(
  paths: CodexInstallPaths,
): Promise<CodexExplicitStateSnapshot> {
  const [globalInstructions, config] = await Promise.all([
    captureCodexExplicitFileState(paths.globalInstructionsPath),
    captureCodexExplicitFileState(paths.configPath),
  ]);
  return { globalInstructions, config };
}

async function refreshOperationOwnedInstructions(
  paths: CodexInstallPaths,
  snapshot: CodexExplicitStateSnapshot,
): Promise<CodexExplicitStateSnapshot> {
  return {
    ...snapshot,
    globalInstructions: await captureCodexExplicitFileState(paths.globalInstructionsPath),
  };
}

async function assertCodexExplicitStateUnchanged(
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

interface CodexExplicitStateDrift {
  globalInstructions?: CodexExplicitFileState;
  config?: CodexExplicitFileState;
}

async function captureCodexExplicitStateDrift(
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

async function restoreCodexExplicitStateDrift(
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

async function readBackupManifest(
  backup: string,
  paths: CodexInstallPaths,
): Promise<BackupManifest> {
  const manifestPath = join(backup, "manifest.json");
  const manifestMetadata = await lstat(manifestPath);
  if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()) {
    throw new Error(`Invalid Codex backup manifest file: ${backup}`);
  }
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!isRecord(parsed)) throw new Error(`Invalid Codex backup manifest: ${backup}`);
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
  if (!isRecord(parsed.payloadHashes)) {
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
    !isRecord(value) ||
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

async function resolveBackup(paths: CodexInstallPaths, target: string | true): Promise<string> {
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

async function restoreBackupPath(
  backup: string,
  rel: string,
  destination: string,
  present: Set<string>,
): Promise<void> {
  await rm(destination, { recursive: true, force: true });
  if (present.has(rel)) await copyIfPresent(join(backup, "files", rel), destination);
}

async function prepareManagedSourceFromBackup(
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

async function restoreCodexBackupExact(paths: CodexInstallPaths, backup: string): Promise<void> {
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

async function restoreCodexAfterFailure(
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

function exactCompensationBackup(paths: CodexInstallPaths, backupName: string): string {
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

async function removeCurrentManagedCodexState(
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

async function discoverPlugin(paths: CodexInstallPaths): Promise<boolean | null> {
  if (isCodexCliSkippedForTests() || !codexCliAvailable()) return null;
  const result = await runCommand(["codex", "plugin", "list", "--json"], paths.codexHome);
  if (result.exitCode !== 0) return null;
  try {
    return parsePluginList(result.stdout).installed;
  } catch {
    return null;
  }
}

export async function gatherCodexStatus(options: CodexStatusOptions = {}): Promise<CodexStatus> {
  const paths = codexInstallPaths(options.homeDir);
  const sentinel = await readSentinel(paths.sentinelPath);
  const packageJson = options.sourceDir
    ? await readJsonOrNull(join(resolve(options.sourceDir), "package.json"))
    : null;
  const rawPackagedVersion = isRecord(packageJson) ? packageJson.version : undefined;
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
