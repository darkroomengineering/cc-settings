import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  assertRuntimeSourceFile,
  CODEX_ADAPTER,
  type CodexInstallPaths,
  type CodexSentinel,
  contentHash,
  EXCLUDED_AGENT_SOURCE_FILES,
  INSTRUCTIONS_END,
  INSTRUCTIONS_START,
  MANAGED_AGENT_NAME,
  MANAGED_AGENT_SOURCE_FILES,
  MANAGED_RULE_NAME,
  type NativeAgent,
  RETIRED_MANAGED_AGENT_NAMES,
  regularFileHash,
  removeFileWithHash,
  SHA256,
  stringArray,
} from "./codex-install-state.ts";
import { runtimePathsForVersion } from "./codex-runtime-manifests.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { isPlainObject } from "./merge-keyed.ts";

function instructionsBlock(repoAgents: string, codexAppend: string): string {
  const body = `${repoAgents.trimEnd()}\n\n${codexAppend.trim()}\n`;
  return `${INSTRUCTIONS_START}\n${body}${INSTRUCTIONS_END}`;
}

export function managedBlockRange(text: string): { start: number; end: number } | null {
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

export function removeInstructions(existing: string): string {
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

export function serializeNativeAgent(agent: NativeAgent, paths: CodexInstallPaths): string {
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

export async function loadNativeAgents(sourceDir: string): Promise<NativeAgent[]> {
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
    if (!isPlainObject(parsed))
      throw new Error(`Cannot convert agents/${entry}: invalid frontmatter`);
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

export async function shippedNativeAgentNames(): Promise<Set<string>> {
  return new Set([
    ...MANAGED_AGENT_SOURCE_FILES.map((entry) => entry.slice(0, -3)),
    ...RETIRED_MANAGED_AGENT_NAMES,
  ]);
}

export function assertBoundedAgentNames(
  names: string[],
  allowedNames: ReadonlySet<string>,
  source: string,
): void {
  const invalid = names.filter((name) => !allowedNames.has(name));
  if (invalid.length > 0) {
    throw new Error(`Unowned managed agent names in ${source}: ${invalid.join(", ")}`);
  }
}

export function assertSentinelAgentOwnership(
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

export async function writeManagedInstructions(
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

export async function removeAgentFiles(
  paths: CodexInstallPaths,
  names: string[],
  hashes: Record<string, string> | undefined,
): Promise<void> {
  for (const name of new Set(names)) {
    if (!MANAGED_AGENT_NAME.test(name)) throw new Error(`Unsafe managed agent name: ${name}`);
    await removeFileWithHash(join(paths.agentsDir, `${name}.toml`), hashes?.[name]);
  }
}

export async function assertNoNativeCollisions(
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

export async function assertInstructionsMergeable(paths: CodexInstallPaths): Promise<void> {
  if (!existsSync(paths.globalInstructionsPath)) return;
  managedBlockRange(await readFile(paths.globalInstructionsPath, "utf8"));
}
