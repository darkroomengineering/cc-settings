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
//
// Responsibilities of this file:
//   1. MCP-from-settings extraction (readMcpFromSettings, findUserOnlyServers)
//   2. User-server preservation prompt (promptPreserveUserServers)
//   3. ~/.claude.json installation (installMcpToClaudeJson) and removal of
//      cc-settings-managed servers on light installs (removeManagedMcpServers)
//
// Generic JSON/atomic-file I/O moved to src/lib/json-io.ts; the settings.json
// merge strategies + orchestrator moved to src/lib/settings-merge.ts.

import { homedir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import { ClaudeJson } from "../schemas/claude-json.ts";
import { McpServers as McpServersSchema } from "../schemas/mcp.ts";
import { debug, error, info, success, warn } from "./colors.ts";
import { atomicWriteJson, readJsonOrNull } from "./json-io.ts";
import { subtractByKey } from "./merge-keyed.ts";
import { promptYn } from "./prompts.ts";

type McpServer = z.infer<typeof McpServersSchema>[string];
export type McpServers = Record<string, McpServer>;

export const CLAUDE_JSON_PATH = join(homedir(), ".claude.json");

// --- Settings.json MCP extraction -----------------------------------------

/** Read MCP servers from a settings.json. Throws JsonParseError on bad JSON. */
export async function readMcpFromSettings(path: string): Promise<McpServers> {
  const raw = await readJsonOrNull(path);
  if (raw === null || typeof raw !== "object") return {};
  const mcp = (raw as Record<string, unknown>).mcpServers;
  if (mcp === undefined) return {};
  const result = McpServersSchema.safeParse(mcp);
  if (!result.success) {
    debug(
      `MCP servers in ${path} failed schema validation: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
    return {};
  }
  return result.data;
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

// --- ~/.claude.json installer --------------------------------------------

/**
 * Install team MCP servers into `~/.claude.json`, preserving any user servers
 * already present. Conflicts: user servers win for existing keys, team
 * definitions fill in missing ones. Atomic.
 *
 * `teamMcp` is the already-extracted team MCP block. It is validated ONCE
 * upstream: composeSettings schema-checks the composed config/ fragments
 * (Settings.mcpServers = McpServers) and throws on failure, so no re-read or
 * re-validation happens here.
 *
 * Uses ClaudeJson (passthrough) so fields we don't know about (Claude-Code-
 * owned state) round-trip untouched.
 */
export async function installMcpToClaudeJson(
  teamMcp: McpServers,
  claudeJsonPath: string = CLAUDE_JSON_PATH,
): Promise<void> {
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

  // Validate existing servers from ~/.claude.json. On schema failure we log a
  // warning but keep the raw value — forward-compat drift (new Claude Code
  // server shapes we don't know yet) should NOT cause us to silently drop user
  // servers. Safety > strict correctness at a write-back boundary.
  const currentMcpRaw = current.mcpServers;
  let currentMcp: McpServers = {};
  if (currentMcpRaw !== undefined) {
    const currentResult = McpServersSchema.safeParse(currentMcpRaw);
    if (!currentResult.success) {
      debug(
        `Existing MCP servers in ${claudeJsonPath} failed schema validation (preserving raw to avoid data loss): ${currentResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
      // Preserve raw — see comment above.
      currentMcp = currentMcpRaw as McpServers;
    } else {
      currentMcp = currentResult.data;
    }
  }
  // Team provides a baseline; user entries shadow on conflict (so the user's
  // local tweak to a shared server wins). Same semantics as the bash merge.
  const mergedMcp: McpServers = { ...teamMcp, ...currentMcp };
  const next = { ...current, mcpServers: mergedMcp };
  await atomicWriteJson(claudeJsonPath, next);
  debug(`Installed MCP servers to ${claudeJsonPath}`);
}

/**
 * Remove cc-settings-managed MCP servers from ~/.claude.json, preserving
 * any user-only servers. Called during a light install — light has no team
 * MCP servers, so the full install's context7 etc. must be removed.
 */
export async function removeManagedMcpServers(
  fullComposed: Record<string, unknown>,
  claudeJsonPath: string = CLAUDE_JSON_PATH,
): Promise<void> {
  const fullMcp = (
    fullComposed.mcpServers !== null && typeof fullComposed.mcpServers === "object"
      ? fullComposed.mcpServers
      : {}
  ) as Record<string, unknown>;
  if (Object.keys(fullMcp).length === 0) return;

  const parsed = await readJsonOrNull(claudeJsonPath);
  if (!parsed || typeof parsed !== "object") return;
  const current = parsed as Record<string, unknown>;
  const currentMcp = (
    current.mcpServers !== null && typeof current.mcpServers === "object" ? current.mcpServers : {}
  ) as Record<string, unknown>;

  // Keep only the servers that are NOT cc-settings-managed (absent from the
  // full baseline) — keyed subtraction on the server name.
  const kept = subtractByKey(Object.entries(currentMcp), Object.entries(fullMcp), ([key]) => key);

  const updated = { ...current };
  if (kept.length === 0) {
    delete updated.mcpServers;
  } else {
    updated.mcpServers = Object.fromEntries(kept);
  }
  await atomicWriteJson(claudeJsonPath, updated);
}
