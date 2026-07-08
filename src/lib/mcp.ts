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
//   - ~/.claude.json uses a loose schema (Claude-Code-owned state we don't edit).
//
// Responsibilities of this file:
//   1. User-only server detection (findUserOnlyServers)
//   2. User-server preservation prompt (promptPreserveUserServers)
//   3. MCP-preservation resolution (resolveMcpServers) — computes the final
//      merged mcpServers object (team base + any user-only extras the user
//      chose to keep). Extracted from the old settings-merge.ts orchestrator so
//      settings-merge.ts stays free of MCP knowledge.
//   4. settings.json merge entry point (mergeSettingsWithMcpPreservation) — the
//      thin wrapper that calls resolveMcpServers then delegates to the pure
//      mergeSettings function in settings-merge.ts.
//   5. ~/.claude.json installation (installMcpToClaudeJson) and removal of
//      cc-settings-managed servers on light installs (removeManagedMcpServers)
//
// Generic JSON/atomic-file I/O moved to src/lib/json-io.ts; the pure settings.json
// merge strategies + orchestrator live in src/lib/settings-merge.ts.

import { homedir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import { ClaudeJson } from "../schemas/claude-json.ts";
import type { McpStdioServer } from "../schemas/mcp.ts";
import { McpServers as McpServersSchema } from "../schemas/mcp.ts";
import { ENGINES, getEngine } from "./code-intel-engine.ts";
import { debug, error, info, success, warn } from "./colors.ts";
import { atomicWriteJson, readJsonOrNull } from "./json-io.ts";
import { asRecord, canonicalKey, subtractByKey } from "./merge-keyed.ts";
import { CLAUDE_DIR } from "./platform.ts";
import { promptYn } from "./prompts.ts";
import { type MergeAccounting, type MergeOptions, mergeSettings } from "./settings-merge.ts";

type McpServer = z.infer<typeof McpServersSchema>[string];
export type McpServers = Record<string, McpServer>;

export const CLAUDE_JSON_PATH = join(homedir(), ".claude.json");

// Server names cc-settings can generate more than one on-disk shape for via
// the code-intel engine indirection (src/lib/code-intel-engine.ts). Currently
// only "tldr" — every ENGINES descriptor shares the same mcpServerName.
const ENGINE_MANAGED_SERVER_NAMES: Set<string> = new Set(
  Object.values(ENGINES).map((e) => e.mcpServerName),
);

function isStdioServer(s: McpServer): s is McpStdioServer {
  return "command" in s;
}

/**
 * True when `entry` (an existing ~/.claude.json server definition) is stale
 * cc-settings output rather than a genuine user edit: it's byte-identical
 * (canonically) to `teamEntry` itself, or — for engine-managed server names —
 * to ANY code-intel engine variant cc-settings can generate for that server
 * (llm-tldr, native-ts, codebase-memory, …).
 *
 * Without this distinction, installMcpToClaudeJson's `{ ...teamMcp,
 * ...currentMcp }` user-wins-on-shared-key rule treats "cc-settings wrote
 * this on a PRIOR install with a different engine" identically to "the user
 * hand-edited this" — so switching CC_CODE_INTEL_ENGINE never actually
 * changes what ~/.claude.json runs (H8). A genuinely user-edited entry (one
 * that matches none of these candidates) still returns false and wins, same
 * as before.
 */
function isStaleCcOutput(name: string, entry: McpServer, teamEntry: McpServer): boolean {
  if (canonicalKey(entry) === canonicalKey(teamEntry)) return true;
  if (!ENGINE_MANAGED_SERVER_NAMES.has(name)) return false;
  if (!isStdioServer(entry) || !isStdioServer(teamEntry)) return false;
  for (const id of Object.keys(ENGINES)) {
    const finalized = getEngine(id, CLAUDE_DIR);
    const candidate: McpStdioServer = {
      ...teamEntry,
      command: finalized.mcp.command,
      args: finalized.mcp.args,
      serverInstructions: finalized.serverInstructions,
    };
    if (canonicalKey(entry) === canonicalKey(candidate)) return true;
  }
  return false;
}

// --- User-only server detection --------------------------------------------

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
 * Uses ClaudeJson (loose schema) so fields we don't know about (Claude-Code-
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
  // Drop currentMcp entries that are stale cc-settings output (this or a prior
  // install's engine choice) before the user-wins spread below — otherwise a
  // resolved engine change in teamMcp (e.g. CC_CODE_INTEL_ENGINE=native-ts)
  // never reaches ~/.claude.json, because the stale entry always looks like a
  // "user override" to the spread. Genuinely user-edited entries (matching
  // neither the team entry nor any known engine variant) are left untouched.
  const effectiveCurrentMcp: McpServers = {};
  for (const [name, entry] of Object.entries(currentMcp)) {
    const teamEntry = teamMcp[name];
    if (teamEntry && isStaleCcOutput(name, entry, teamEntry)) continue;
    effectiveCurrentMcp[name] = entry;
  }

  // Team provides a baseline; user entries shadow on conflict (so the user's
  // local tweak to a shared server wins). Same semantics as the bash merge.
  const mergedMcp: McpServers = { ...teamMcp, ...effectiveCurrentMcp };
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
  const fullMcp = asRecord(fullComposed.mcpServers);
  if (Object.keys(fullMcp).length === 0) return;

  const parsed = await readJsonOrNull(claudeJsonPath);
  if (!parsed || typeof parsed !== "object") return;
  const current = parsed as Record<string, unknown>;
  const currentMcp = asRecord(current.mcpServers);

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

// --- MCP-preserving settings.json merge ----------------------------------

/**
 * Compute the final merged mcpServers value from a user's existing servers and
 * the team's baseline servers. This encapsulates the MCP-preservation semantics
 * that used to live inline in the settings merger:
 *
 *   - Team servers form the base.
 *   - Servers present in the user's settings but absent from the team config
 *     are "user-only" extras. The user is prompted to keep or drop them
 *     (or CC_WIPE_CUSTOM_MCP=1 drops them silently).
 *   - Kept user-only servers are overlaid onto the team base.
 *   - Servers present in BOTH configs: if the user's definition differs from
 *     the team's (deep-compared), the user's customization wins — same
 *     "user wins" precedence as installMcpToClaudeJson's `{ ...teamMcp,
 *     ...currentMcp }`. Identical definitions take the team value as-is (no
 *     accounting noise; nothing was actually overridden). Without this, a
 *     user's local tweak to a shared server (e.g. context7 env/args) would be
 *     silently reverted to the team default on every re-install.
 *
 * @param userServers  McpServers extracted from the user's existing settings.json
 * @param teamServers  McpServers from the composed team config (already validated)
 * @returns            The resolved McpServers to write into the output file
 */
export async function resolveMcpServers(
  userServers: McpServers,
  teamServers: McpServers,
): Promise<McpServers> {
  const userOnly = findUserOnlyServers(userServers, teamServers);
  let preserved: McpServers = {};
  if (userOnly.length > 0) {
    ({ preserved } = await promptPreserveUserServers(userOnly, userServers));
  } else {
    debug("No user-only MCP servers");
  }

  // Shared server names (present in both): preserve the user's definition
  // when it diverges from the team's. Identical definitions are left to the
  // team spread below (no-op, same value either way).
  const diverged: string[] = [];
  const userOverrides: McpServers = {};
  for (const name of Object.keys(teamServers)) {
    const userDef = userServers[name];
    if (userDef === undefined) continue; // not shared — findUserOnlyServers handles it
    if (canonicalKey(userDef) !== canonicalKey(teamServers[name])) {
      diverged.push(name);
      userOverrides[name] = userDef;
    }
  }
  if (diverged.length > 0) {
    info(
      `Preserving your customization of ${diverged.length} shared MCP server(s): ${diverged.join(", ")}`,
    );
  }

  // Team is the base; user-only preserved extras and diverged user overrides
  // are overlaid on top (user wins on conflict).
  return { ...teamServers, ...preserved, ...userOverrides };
}

/**
 * Merge user's existing settings.json with the in-memory team settings object,
 * preserving user-only MCP servers via an interactive (or CC_WIPE_CUSTOM_MCP=1)
 * preservation prompt.
 *
 * This is the thin orchestration wrapper that:
 *   1. Reads + parses the user's mcpServers from the existing settings.json.
 *   2. Calls resolveMcpServers to compute the final merged mcpServers.
 *   3. Delegates the full settings merge to the pure `mergeSettings` function in
 *      settings-merge.ts, passing the resolved mcpServers so the pure merger
 *      doesn't need MCP knowledge.
 *
 * The observable output is byte-identical to the old combined function — same
 * servers preserved, same precedence, same _status handling.
 */
export async function mergeSettingsWithMcpPreservation(
  existingPath: string,
  teamSettings: Record<string, unknown>,
  outputPath: string,
  opts: MergeOptions = {},
): Promise<MergeAccounting | null> {
  // Peek at the user's existing file to extract current mcpServers so we can
  // run the preservation prompt before the per-key merge loop.
  // readJsonOrNull throws on unparseable JSON (JsonParseError) — honored here
  // so bad JSON always aborts rather than silently wiping user MCP config.
  const userRaw = (await readJsonOrNull(existingPath)) as Record<string, unknown> | null;

  if (!userRaw) {
    // No existing file — delegate directly; the pure merger writes team as-is.
    return mergeSettings(existingPath, teamSettings, outputPath, opts);
  }

  // asRecord: a corrupt string-valued mcpServers degrades to {} instead of
  // leaking a string into the server merge.
  const userServers = asRecord(userRaw.mcpServers) as McpServers;
  const teamServers = asRecord(teamSettings.mcpServers) as McpServers;

  const resolvedMcp = await resolveMcpServers(userServers, teamServers);

  // Delegate to the pure merger, supplying the already-resolved mcpServers.
  // The pure merger skips the mcpServers key in its per-key strategy loop and
  // uses the value we computed here instead.
  return mergeSettings(existingPath, teamSettings, outputPath, opts, resolvedMcp);
}
