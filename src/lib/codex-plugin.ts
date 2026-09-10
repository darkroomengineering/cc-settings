import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type BackupPluginState,
  type CodexInstallPaths,
  type CodexPluginState,
  type CodexSentinel,
  codexCliAvailable,
  isCodexCliSkippedForTests,
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
