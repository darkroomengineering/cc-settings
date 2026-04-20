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

/**
 * Merge user's existing settings.json with the team settings.json. The team
 * file is authoritative for its keys; user-only MCP servers are preserved
 * per the preservation prompt.
 */
export async function mergeSettingsWithMcpPreservation(
  existingPath: string,
  teamPath: string,
  outputPath: string,
): Promise<void> {
  const teamRaw = (await readJsonOrNull(teamPath)) as {
    mcpServers?: McpServers;
    [key: string]: unknown;
  } | null;
  if (!teamRaw) throw new Error(`Team settings not found: ${teamPath}`);

  const userRaw = (await readJsonOrNull(existingPath)) as {
    mcpServers?: McpServers;
  } | null;

  // No existing file → write team as-is (atomic).
  if (!userRaw) {
    await atomicWriteJson(outputPath, teamRaw);
    return;
  }

  const userServers = userRaw.mcpServers ?? {};
  const teamServers = teamRaw.mcpServers ?? {};
  const userOnly = findUserOnlyServers(userServers, teamServers);

  if (userOnly.length === 0) {
    debug("No user-only MCP servers, using team config");
    await atomicWriteJson(outputPath, teamRaw);
    return;
  }

  const { preserved } = await promptPreserveUserServers(userOnly, userServers);

  const merged: typeof teamRaw = {
    ...teamRaw,
    mcpServers: { ...teamServers, ...preserved },
  };
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
