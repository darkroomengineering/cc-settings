import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type BackupPluginState,
  type CodexInstallPaths,
  type CodexPluginState,
  type CodexSentinel,
  codexCliAvailable,
  contentHash,
  isCodexCliSkippedForTests,
  lstatOrNull,
  regularFileHash,
  runCommand,
  toPluginState,
} from "./codex-install-state.ts";
import { isPlainObject } from "./merge-keyed.ts";

function nestedString(value: unknown, objectKey: string, stringKey: string): string | null {
  if (!isPlainObject(value)) return null;
  const nested = value[objectKey];
  return isPlainObject(nested) && typeof nested[stringKey] === "string" ? nested[stringKey] : null;
}

function parsePluginList(stdout: string): {
  installed: boolean;
  enabled: boolean;
  source: string | null;
} {
  const parsed: unknown = JSON.parse(stdout);
  if (!isPlainObject(parsed) || !Array.isArray(parsed.installed)) {
    throw new Error("Invalid Codex plugin list response");
  }
  const matches = parsed.installed.filter(
    (item) =>
      isPlainObject(item) &&
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
  if (!isPlainObject(parsed) || !Array.isArray(parsed.marketplaces)) {
    throw new Error("Invalid Codex marketplace list response");
  }
  const matches = parsed.marketplaces.filter(
    (item) => isPlainObject(item) && item.name === "cc-settings",
  );
  if (matches.length > 1) throw new Error("Ambiguous cc-settings Codex marketplace state");
  const match = matches[0];
  if (!isPlainObject(match)) return { enrolled: false, source: null };
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

export async function canonicalManagedSourcePath(paths: CodexInstallPaths): Promise<string> {
  const codexRoot = await realpath(paths.codexHome).catch(() => resolve(paths.codexHome));
  return join(codexRoot, relative(paths.codexHome, paths.managedSource));
}

export async function readCodexPluginState(
  paths: CodexInstallPaths,
): Promise<CodexPluginState | null> {
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

export async function assertManagedPluginProvenance(
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

export async function isManagedPluginSource(
  paths: CodexInstallPaths,
  managedSource: string,
  pluginSource: string | null,
): Promise<boolean> {
  if (!pluginSource) return false;
  if (pluginSource === managedSource) return true;
  const cacheRootPath = join(paths.codexHome, "plugins", "cache", "cc-settings");
  const cacheRoot = await realpath(cacheRootPath).catch(() => null);
  if (!cacheRoot) return false;
  const fromCache = relative(cacheRoot, pluginSource);
  return Boolean(
    fromCache && fromCache !== ".." && !fromCache.startsWith(`..${sep}`) && !isAbsolute(fromCache),
  );
}

export async function installPlugin(paths: CodexInstallPaths): Promise<void> {
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

export async function restorePluginState(
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

export async function removePlugin(paths: CodexInstallPaths, required = false): Promise<void> {
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

export async function discoverPlugin(paths: CodexInstallPaths): Promise<boolean | null> {
  if (isCodexCliSkippedForTests() || !codexCliAvailable()) return null;
  const result = await runCommand(["codex", "plugin", "list", "--json"], paths.codexHome);
  if (result.exitCode !== 0) return null;
  try {
    return parsePluginList(result.stdout).installed;
  } catch {
    return null;
  }
}

// Codex loads no hooks from a root-manifest plugin, so the installer writes the
// plugin's hooks as user-level hooks in `$CODEX_HOME/hooks.json`. Codex gives
// user hooks no PLUGIN_ROOT, so each command points at the managed source.
// Hooks run in the session's directory, and Bun loads that directory's `.env`,
// so every command passes --no-env-file. The path goes inside double quotes;
// these characters could end the quoted string in sh, cmd or PowerShell.
const UNSAFE_HOOK_PATH_CHARACTERS = /["$`%\r\n“”„]/;
const PLACEHOLDER = /\$PLUGIN_ROOT|%PLUGIN_ROOT%/g;
const QUOTED_PLACEHOLDER = /"(?:\$PLUGIN_ROOT|%PLUGIN_ROOT%)[^"]*"/g;

function rewriteHookCommand(command: string, managedSource: string): string {
  const placeholders = command.match(PLACEHOLDER)?.length ?? 0;
  if ((command.match(QUOTED_PLACEHOLDER)?.length ?? 0) !== placeholders) {
    throw new Error(`hooks/hooks.json must quote PLUGIN_ROOT: ${command}`);
  }
  if (!command.startsWith("bun ")) {
    throw new Error(`hooks/hooks.json commands must run bun: ${command}`);
  }
  return `bun --no-env-file ${command.slice("bun ".length)}`
    .replaceAll("$PLUGIN_ROOT", managedSource)
    .replaceAll("%PLUGIN_ROOT%", managedSource);
}

function rewriteHookCommands(value: unknown, managedSource: string): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteHookCommands(item, managedSource));
  if (!isPlainObject(value)) return value;
  const rewritten: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if ((key === "command" || key === "commandWindows") && typeof child === "string") {
      rewritten[key] = rewriteHookCommand(child, managedSource);
    } else {
      rewritten[key] = rewriteHookCommands(child, managedSource);
    }
  }
  return rewritten;
}

/** Turn the plugin's `hooks/hooks.json` template into the user-level file. */
export function serializeUserHooks(template: string, managedSource: string): string {
  if (UNSAFE_HOOK_PATH_CHARACTERS.test(managedSource)) {
    throw new Error(`Managed Codex source path cannot be used in a hook command: ${managedSource}`);
  }
  const parsed: unknown = JSON.parse(template);
  if (!isPlainObject(parsed) || !isPlainObject(parsed.hooks)) {
    throw new Error("hooks/hooks.json must contain a hooks object");
  }
  const output = `${JSON.stringify(rewriteHookCommands(parsed, managedSource), null, 2)}\n`;
  if (output.includes("PLUGIN_ROOT")) {
    throw new Error("hooks/hooks.json uses PLUGIN_ROOT outside a command field");
  }
  return output;
}

// cc-settings owns individual hook groups in `$CODEX_HOME/hooks.json`, never the
// file. Other tools (Programa, hand edits) keep their own groups there. A group
// is ours when every handler runs the managed hook runner; ours are appended
// after the foreign groups of each event so foreign positions never shift.
type HookGroup = Record<string, unknown> & { hooks: unknown[] };
type HookEvents = Record<string, HookGroup[]>;

interface HooksFile {
  document: Record<string, unknown>;
  events: HookEvents;
  hash: string;
  mode: number;
}

// Ours means the command starts with `bun --no-env-file "<absolute path>/darkroom/source/src/scripts/codex-hook.ts"`,
// as the template writes it, and every command field the handler has (command, commandWindows)
// says so. The prefix before `darkroom/source` is free so groups written under a different
// CODEX_HOME still match. The closing quote rejects `codex-hook.ts.backup`.
const OWNED_RUNNER =
  /^bun --no-env-file "(?:[A-Za-z]:)?[\\/](?:[^"]*[\\/])?darkroom[\\/]source[\\/]src[\\/]scripts[\\/]codex-hook\.ts"/;

function isOwnedHandler(handler: unknown): boolean {
  if (!isPlainObject(handler)) return false;
  const commands = [handler.command, handler.commandWindows].filter(
    (command) => command !== undefined,
  );
  return (
    commands.length > 0 &&
    commands.every((command) => typeof command === "string" && OWNED_RUNNER.test(command))
  );
}

function isOwnedGroup(group: HookGroup, where: string): boolean {
  const owned = group.hooks.filter((handler) => isOwnedHandler(handler)).length;
  if (owned === 0) return false;
  if (owned !== group.hooks.length) {
    throw new Error(
      `${where} has a hook group that mixes cc-settings and other handlers. ` +
        "Split it into separate groups; install, uninstall and rollback are blocked until then.",
    );
  }
  return true;
}

/** Read and validate a hooks file for merging. Null when it does not exist. */
async function readHooksFile(path: string): Promise<HooksFile | null> {
  const metadata = await lstatOrNull(path);
  if (!metadata) return null;
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(
      `${path} is a symlink or not a regular file; cc-settings will not merge into it.`,
    );
  }
  const raw = await readFile(path);
  let document: unknown;
  try {
    document = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error(`${path} is not valid JSON; fix or remove it, then rerun the install.`);
  }
  if (!isPlainObject(document)) throw new Error(`${path} must contain a JSON object.`);
  const hooks = document.hooks ?? {};
  if (!isPlainObject(hooks)) throw new Error(`${path} has a "hooks" value that is not an object.`);
  const events: HookEvents = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) throw new Error(`${path}: hooks.${event} is not an array.`);
    for (const group of groups) {
      if (!isPlainObject(group) || !Array.isArray(group.hooks)) {
        throw new Error(`${path}: a hooks.${event} group has no "hooks" array.`);
      }
      isOwnedGroup(group as HookGroup, path);
    }
    events[event] = groups as HookGroup[];
  }
  return { document, events, hash: contentHash(raw), mode: metadata.mode & 0o777 };
}

function splitOwned(events: HookEvents): {
  foreign: HookEvents;
  owned: HookEvents;
  removed: boolean;
} {
  const foreign: HookEvents = {};
  const owned: HookEvents = {};
  let removed = false;
  for (const [event, groups] of Object.entries(events)) {
    const keep = groups.filter((group) => !isOwnedGroup(group, event));
    const ours = groups.filter((group) => isOwnedGroup(group, event));
    if (ours.length > 0) {
      removed = true;
      owned[event] = ours;
    }
    // An event that held only our groups disappears; a foreign empty event stays.
    if (keep.length > 0 || ours.length === 0) foreign[event] = keep;
  }
  return { foreign, owned, removed };
}

/** Replace (or, with null content, delete) the hooks file if it is unchanged since it was read. */
async function commitHooksFile(
  paths: CodexInstallPaths,
  expectedHash: string | null,
  content: string | null,
  mode: number,
): Promise<void> {
  const changed = () =>
    new Error(`${paths.hooksPath} changed since cc-settings read it; rerun the install.`);
  const unchanged = async (): Promise<boolean> => {
    const metadata = await lstatOrNull(paths.hooksPath);
    if (expectedHash === null) return metadata === null;
    return metadata !== null && (await regularFileHash(paths.hooksPath)) === expectedHash;
  };
  if (content === null) {
    // SHORTCUT: same unlocked check-then-delete; see below.
    if (!(await unchanged())) throw changed();
    await rm(paths.hooksPath, { force: true });
    return;
  }
  await mkdir(paths.codexHome, { recursive: true });
  const temp = join(paths.codexHome, `.hooks.json.cc-settings-${process.pid}-${randomUUID()}.tmp`);
  let created = false;
  try {
    // "wx" refuses an existing path, so a planted symlink is never followed.
    await writeFile(temp, content, { mode, flag: "wx" });
    created = true;
    // SHORTCUT: hash check, then rename, with no lock. ceiling: a write landing between the check
    // and the rename is lost. upgrade: an advisory lock shared with other writers, when a lost
    // hooks.json edit from a concurrent writer is reported.
    if (!(await unchanged())) throw changed();
    await rename(temp, paths.hooksPath);
  } catch (cause) {
    if (created) await rm(temp, { force: true }).catch(() => {});
    throw cause;
  }
}

function serializeHooksFile(document: Record<string, unknown>, events: HookEvents): string {
  const next: Record<string, unknown> = { ...document };
  if (Object.keys(events).length > 0 || "hooks" in document) next.hooks = events;
  return `${JSON.stringify(next, null, 2)}\n`;
}

/** Fail closed before any write when `$CODEX_HOME/hooks.json` cannot be merged into. */
export async function assertManagedHooksMergeable(paths: CodexInstallPaths): Promise<void> {
  await readHooksFile(paths.hooksPath);
}

/**
 * Merge the plugin's hook groups into the user-level hooks file: strip our
 * previous groups, append the fresh ones after each event's foreign groups, and
 * keep every other key and group as it was.
 */
export async function writeUserHooks(sourceDir: string, paths: CodexInstallPaths): Promise<void> {
  const template: unknown = JSON.parse(
    serializeUserHooks(
      await readFile(join(sourceDir, "hooks", "hooks.json"), "utf8"),
      paths.managedSource,
    ),
  );
  const fresh = (isPlainObject(template) ? template.hooks : {}) as HookEvents;
  const existing = await readHooksFile(paths.hooksPath);
  const { foreign } = splitOwned(existing?.events ?? {});
  const merged: HookEvents = { ...foreign };
  for (const [event, groups] of Object.entries(fresh)) {
    merged[event] = [...(merged[event] ?? []), ...groups];
  }
  await commitHooksFile(
    paths,
    existing?.hash ?? null,
    serializeHooksFile(existing?.document ?? {}, merged),
    existing?.mode ?? 0o644,
  );
}

/** Remove only our hook groups. Deletes the file when nothing else was in it. */
export async function stripManagedHooks(paths: CodexInstallPaths): Promise<boolean> {
  const existing = await readHooksFile(paths.hooksPath);
  if (!existing) return false;
  const { foreign, removed } = splitOwned(existing.events);
  if (!removed) return false;
  const otherKeys = Object.keys(existing.document).filter((key) => key !== "hooks");
  if (otherKeys.length === 0 && Object.keys(foreign).length === 0) {
    await commitHooksFile(paths, existing.hash, null, existing.mode);
  } else {
    await commitHooksFile(
      paths,
      existing.hash,
      serializeHooksFile(existing.document, foreign),
      existing.mode,
    );
  }
  return true;
}

/** Re-append the groups of ours found in a backed-up hooks file (rollback). */
export async function restoreManagedHooksFromBackup(
  paths: CodexInstallPaths,
  backupFile: string,
): Promise<boolean> {
  const backed = await readHooksFile(backupFile);
  if (!backed) return false;
  const { owned } = splitOwned(backed.events);
  if (Object.keys(owned).length === 0) return false;
  const live = await readHooksFile(paths.hooksPath);
  const merged: HookEvents = { ...splitOwned(live?.events ?? {}).foreign };
  for (const [event, groups] of Object.entries(owned)) {
    merged[event] = [...(merged[event] ?? []), ...groups];
  }
  await commitHooksFile(
    paths,
    live?.hash ?? null,
    serializeHooksFile(live?.document ?? {}, merged),
    live?.mode ?? 0o644,
  );
  return true;
}

/** Codex warns when hooks exist in both hooks.json and config.toml. Read-only. */
export async function warnOnConfigTomlHooks(paths: CodexInstallPaths): Promise<void> {
  const text = await readFile(paths.configPath, "utf8").catch(() => null);
  if (text === null) return;
  let hooks: unknown;
  try {
    hooks = (Bun.TOML.parse(text) as Record<string, unknown>).hooks;
  } catch {
    return;
  }
  // `[hooks.state."<key>"]` holds Codex's own trust records, not hook definitions.
  if (isPlainObject(hooks) && Object.keys(hooks).some((key) => key !== "state")) {
    console.warn(
      `${paths.configPath} has a [hooks] table. Codex warns when hooks are defined in both config.toml and ${paths.hooksPath}.`,
    );
  }
}
