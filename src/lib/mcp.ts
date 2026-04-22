// MCP server detection, preservation, and merging — port of lib/mcp.sh.
//
// The critical invariants (inherited from the bash hardening pass):
//   1. Unparseable JSON → abort loudly. Never fall through to a cp that wipes
//      user-only MCPs.
//   2. All writes are atomic (tmp + rename, same directory).
//   3. CC_WIPE_CUSTOM_MCP=1 is the ONLY way to drop user-only servers without
//      an interactive confirmation.
//
// Validation uses zod schemas:
//   - McpServers shape from src/schemas/mcp.ts (discriminated stdio vs http).
//   - ~/.claude.json uses passthrough (Claude-Code-owned state we don't edit).

import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { ClaudeJson } from "../schemas/claude-json.ts";
import type { McpServers as McpServersSchema } from "../schemas/mcp.ts";
import { debug, error, info, success, warn } from "./colors.ts";
import { promptYn } from "./prompts.ts";

type McpServer = z.infer<typeof McpServersSchema>[string];
type McpServers = Record<string, McpServer>;

export const CLAUDE_JSON_PATH = join(homedir(), ".claude.json");

/** Raised when JSON is unparseable. Callers MUST treat this as a hard failure. */
export class McpParseError extends Error {
  constructor(
    public readonly path: string,
    cause: unknown,
  ) {
    super(`${path} is not valid JSON. Fix it or restore a backup before re-running setup.`);
    this.name = "McpParseError";
    if (cause instanceof Error) this.cause = cause;
  }
}

// --- Atomic IO helpers ----------------------------------------------------

/** Stage + rename in the same directory so crashes don't leave a half-written target. */
export async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const dir = dirname(path);
  const tmp = join(dir, `.${process.pid}-${Date.now()}.tmp`);
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmp, path);
}

export async function readJsonOrNull<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new McpParseError(path, err);
  }
}

// --- Settings.json MCP extraction -----------------------------------------

/** Read MCP servers from a settings.json. Throws McpParseError on bad JSON. */
export async function readMcpFromSettings(path: string): Promise<McpServers> {
  const data = (await readJsonOrNull(path)) as { mcpServers?: McpServers } | null;
  if (!data) return {};
  return data.mcpServers ?? {};
}

export function findUserOnlyServers(userServers: McpServers, teamServers: McpServers): string[] {
  return Object.keys(userServers).filter((name) => !(name in teamServers));
}

// --- Preservation workflow ------------------------------------------------

interface PreservationResult {
  preserved: McpServers;
  dropped: string[];
}

/**
 * Interactive prompt flow for user-only MCP servers. Honors CC_WIPE_CUSTOM_MCP=1
 * as the only mechanism that allows silent drop.
 */
export async function promptPreserveUserServers(
  userOnly: string[],
  userServers: McpServers,
): Promise<PreservationResult> {
  if (userOnly.length === 0) return { preserved: {}, dropped: [] };

  info(`You have ${userOnly.length} custom MCP server(s) not in the team config:`);
  console.log("");
  for (const name of userOnly) console.log(`  - ${name}`);
  console.log("");

  // Hard opt-out: explicit env var. Everything else defaults to preserve.
  if (process.env.CC_WIPE_CUSTOM_MCP === "1") {
    warn(`CC_WIPE_CUSTOM_MCP=1 — dropping ${userOnly.length} custom MCP server(s)`);
    return { preserved: {}, dropped: userOnly };
  }

  const keep = await promptYn("Keep these servers? (they'll be merged with team config)", true);
  if (keep) {
    success(`Keeping all ${userOnly.length} custom server(s)`);
    const preserved: McpServers = {};
    for (const name of userOnly) {
      const s = userServers[name];
      if (s) preserved[name] = s;
    }
    return { preserved, dropped: [] };
  }

  warn(`User chose not to preserve — ${userOnly.length} custom MCP server(s) will be dropped`);
  return { preserved: {}, dropped: userOnly };
}

// --- Settings.json merge --------------------------------------------------

type StringArray = string[] | undefined;
type UnknownRecord = Record<string, unknown>;

// Union two string arrays: team entries stay as the floor, user extras append.
// Preserves order, dedupes, returns count of user-only additions for logging.
function unionPermissionArray(
  team: StringArray,
  user: StringArray,
): { merged: string[] | undefined; added: number } {
  const teamArr = team ?? [];
  const userArr = user ?? [];
  if (teamArr.length === 0 && userArr.length === 0) return { merged: undefined, added: 0 };
  const teamSet = new Set(teamArr);
  const extras = userArr.filter((r) => !teamSet.has(r));
  const merged = [...teamArr, ...extras];
  return { merged, added: extras.length };
}

// Deep-merge permissions blocks: user wins on scalar fields (defaultMode,
// autoMode), arrays are unioned so team baseline survives while user additions
// are preserved.
function mergePermissions(
  team: UnknownRecord | undefined,
  user: UnknownRecord | undefined,
): { merged: UnknownRecord | undefined; added: number } {
  if (!team && !user) return { merged: undefined, added: 0 };
  const t = team ?? {};
  const u = user ?? {};
  const allow = unionPermissionArray(t.allow as StringArray, u.allow as StringArray);
  const deny = unionPermissionArray(t.deny as StringArray, u.deny as StringArray);
  const ask = unionPermissionArray(t.ask as StringArray, u.ask as StringArray);
  const dirs = unionPermissionArray(
    t.additionalDirectories as StringArray,
    u.additionalDirectories as StringArray,
  );
  // Scalars / objects: user wins when declared.
  const merged: UnknownRecord = { ...t, ...u };
  if (allow.merged !== undefined) merged.allow = allow.merged;
  if (deny.merged !== undefined) merged.deny = deny.merged;
  if (ask.merged !== undefined) merged.ask = ask.merged;
  if (dirs.merged !== undefined) merged.additionalDirectories = dirs.merged;
  return { merged, added: allow.added + deny.added + ask.added + dirs.added };
}

// Per-event union of hook groups. Team groups run first (they power cc-settings);
// user-added groups that aren't byte-identical to a team group are appended.
function mergeHooks(
  team: UnknownRecord | undefined,
  user: UnknownRecord | undefined,
): { merged: UnknownRecord | undefined; added: number } {
  if (!team && !user) return { merged: undefined, added: 0 };
  const t = team ?? {};
  const u = user ?? {};
  const events = new Set([...Object.keys(t), ...Object.keys(u)]);
  const merged: UnknownRecord = {};
  let added = 0;
  for (const ev of events) {
    const teamGroups = Array.isArray(t[ev]) ? (t[ev] as unknown[]) : [];
    const userGroups = Array.isArray(u[ev]) ? (u[ev] as unknown[]) : [];
    const teamJson = new Set(teamGroups.map((g) => JSON.stringify(g)));
    const extras = userGroups.filter((g) => !teamJson.has(JSON.stringify(g)));
    added += extras.length;
    merged[ev] = extras.length > 0 ? [...teamGroups, ...extras] : teamGroups;
  }
  return { merged, added };
}

// Shallow env merge: user values win on key conflict (local overrides for
// cache flags, debug toggles, etc. stick across re-installs).
function mergeEnv(
  team: UnknownRecord | undefined,
  user: UnknownRecord | undefined,
): { merged: UnknownRecord | undefined; userWins: number } {
  if (!team && !user) return { merged: undefined, userWins: 0 };
  const t = team ?? {};
  const u = user ?? {};
  let userWins = 0;
  for (const k of Object.keys(u)) if (k in t && u[k] !== t[k]) userWins++;
  return { merged: { ...t, ...u }, userWins };
}

/**
 * Merge user's existing settings.json with the team settings.json. Policy:
 *   - User-declared keys win for top-level scalars (model, statusLine, …).
 *   - `permissions.{allow,deny,ask,additionalDirectories}` are unioned so the
 *     team baseline (guardrails, common tool access) survives while user
 *     additions (the common complaint) are preserved.
 *   - `hooks` is per-event union of groups.
 *   - `env` shallow-merges with user values winning.
 *   - `mcpServers` uses the interactive preservation prompt.
 */
export async function mergeSettingsWithMcpPreservation(
  existingPath: string,
  teamPath: string,
  outputPath: string,
): Promise<void> {
  const teamRaw = (await readJsonOrNull(teamPath)) as UnknownRecord | null;
  if (!teamRaw) throw new Error(`Team settings not found: ${teamPath}`);

  const userRaw = (await readJsonOrNull(existingPath)) as UnknownRecord | null;

  // No existing file → write team as-is (atomic).
  if (!userRaw) {
    await atomicWriteJson(outputPath, teamRaw);
    return;
  }

  const userServers = (userRaw.mcpServers as McpServers | undefined) ?? {};
  const teamServers = (teamRaw.mcpServers as McpServers | undefined) ?? {};
  const userOnly = findUserOnlyServers(userServers, teamServers);

  let preserved: McpServers = {};
  if (userOnly.length > 0) {
    ({ preserved } = await promptPreserveUserServers(userOnly, userServers));
  } else {
    debug("No user-only MCP servers");
  }

  const permissions = mergePermissions(
    teamRaw.permissions as UnknownRecord | undefined,
    userRaw.permissions as UnknownRecord | undefined,
  );
  const hooks = mergeHooks(
    teamRaw.hooks as UnknownRecord | undefined,
    userRaw.hooks as UnknownRecord | undefined,
  );
  const env = mergeEnv(
    teamRaw.env as UnknownRecord | undefined,
    userRaw.env as UnknownRecord | undefined,
  );

  // Start from team (authoritative for unknown keys), overlay user top-level
  // scalars/objects (user wins when declared), then slot in the field-specific
  // merges so they aren't clobbered by the user overlay.
  const merged: UnknownRecord = { ...teamRaw, ...userRaw };
  merged.mcpServers = { ...teamServers, ...preserved };
  if (permissions.merged !== undefined) merged.permissions = permissions.merged;
  else delete merged.permissions;
  if (hooks.merged !== undefined) merged.hooks = hooks.merged;
  else delete merged.hooks;
  if (env.merged !== undefined) merged.env = env.merged;
  else delete merged.env;

  const bits: string[] = [];
  if (permissions.added > 0) bits.push(`${permissions.added} permission rule(s)`);
  if (hooks.added > 0) bits.push(`${hooks.added} hook group(s)`);
  if (env.userWins > 0) bits.push(`${env.userWins} env override(s)`);
  if (bits.length > 0) success(`Preserved user customization: ${bits.join(", ")}`);

  await atomicWriteJson(outputPath, merged);
}

// --- ~/.claude.json installer --------------------------------------------

/**
 * Install team MCP servers into `~/.claude.json`, preserving any user servers
 * already present. Conflicts: user servers win for existing keys, team
 * definitions fill in missing ones. Atomic.
 *
 * Uses ClaudeJson (passthrough) so fields we don't know about (Claude-Code-
 * owned state) round-trip untouched.
 */
export async function installMcpToClaudeJson(
  teamSettingsPath: string,
  claudeJsonPath: string = CLAUDE_JSON_PATH,
): Promise<void> {
  const team = (await readJsonOrNull(teamSettingsPath)) as {
    mcpServers?: McpServers;
  } | null;
  if (!team) {
    warn(`Team settings not found: ${teamSettingsPath}`);
    return;
  }
  const teamMcp = team.mcpServers ?? {};
  if (Object.keys(teamMcp).length === 0) {
    debug("No MCP servers in team config");
    return;
  }

  // Read existing claude.json — tolerate absence, but don't tolerate corruption.
  let current: Record<string, unknown> = {};
  const parsed = (await readJsonOrNull(claudeJsonPath)) ?? {};
  const validated = ClaudeJson.safeParse(parsed);
  if (!validated.success) {
    error(`${claudeJsonPath} failed schema check: ${validated.error.issues[0]?.message ?? ""}`);
    error("Refusing to write merged MCPs — fix the file before re-running setup.");
    return;
  }
  current = validated.data as Record<string, unknown>;

  const currentMcp = (current.mcpServers as McpServers | undefined) ?? {};
  // Team provides a baseline; user entries shadow on conflict (so the user's
  // local tweak to a shared server wins). Same semantics as the bash merge.
  const mergedMcp: McpServers = { ...teamMcp, ...currentMcp };
  const next = { ...current, mcpServers: mergedMcp };
  await atomicWriteJson(claudeJsonPath, next);
  debug(`Installed MCP servers to ${claudeJsonPath}`);
}
