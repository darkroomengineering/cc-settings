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
import type { McpStdioServer } from "../schemas/mcp.ts";
import { McpServers as McpServersSchema } from "../schemas/mcp.ts";
import { ENGINES, getEngine } from "./code-intel-engine.ts";
import { debug, info, success, warn } from "./colors.ts";
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
 *
 * `priorWritten`, when supplied, is an exact echo of what THIS server name got
 * written to disk on the run that stamped the current sentinel (see
 * `mcp_written` in src/setup.ts writeVersionSentinel). The live-registry loop
 * above can only recognize shapes the CURRENT code would generate — the
 * moment a descriptor's serverInstructions text changes (as happened across
 * v12.8.1 / v12.9.0), yesterday's output stops matching any live candidate and
 * gets misclassified as a hand-edit. `priorWritten` closes that gap: it is
 * recorded fact, not derived from code that may have since changed. A genuine
 * hand-edit still differs from `priorWritten` too (by construction — it's an
 * exact echo of what cc-settings itself wrote), so it still falls through to
 * `false` below.
 */
function isStaleCcOutput(
  name: string,
  entry: McpServer,
  teamEntry: McpServer,
  priorWritten?: McpServer,
): boolean {
  if (functionalKey(entry) === functionalKey(teamEntry)) return true;
  if (priorWritten && functionalKey(entry) === functionalKey(priorWritten)) return true;
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
    if (functionalKey(entry) === functionalKey(candidate)) return true;
  }
  return false;
}

/**
 * `_`-prefixed keys are documentation-only annotations (`_status`, `_comment`,
 * `_description`, …) that Claude Code ignores and the settings composer strips.
 * They say nothing about how a server RUNS, so two definitions differing only
 * in them are the same server.
 *
 * This matters because equality here decides ownership. Older installs wrote
 * `_status`/`_comment` inline; those keys survive in ~/.claude.json and made an
 * otherwise byte-identical entry compare unequal to ours — so isStaleCcOutput
 * called it a hand-edit, the merge preserved it, and cc-settings' own updates
 * to that server could never land again. Comparing on functional fields only
 * lets those entries be recognized and refreshed, while a genuine customization
 * (different command/args/url/headers) still differs and is still preserved.
 */
// Exactly the keys `mcpCommentary` in src/schemas/mcp.ts documents as
// commentary. Deliberately a closed list rather than a `_`-prefix test: an
// unknown `_`-prefixed field might be a real Claude Code extension we don't
// model yet, and treating it as decoration would let the merge overwrite it.
// Unknown `_` keys therefore still count as a divergence — fail safe.
// `serverInstructions` is NOT here; Claude Code reads it, so it is functional.
const ANNOTATION_KEYS: ReadonlySet<string> = new Set([
  "_comment",
  "_description",
  "_usage",
  "_contextCost",
  "_status",
]);

function stripAnnotations(v: unknown): unknown {
  const rec = asRecord(v);
  if (!rec) return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(rec)) {
    if (!ANNOTATION_KEYS.has(k)) out[k] = val;
  }
  return out;
}

/** canonicalKey over functional fields only — annotation-blind, order-blind. */
export function functionalKey(v: unknown): string {
  return canonicalKey(stripAnnotations(v));
}

/**
 * Top-level functional keys whose values differ between two MCP server
 * definitions, sorted. Compared with canonicalKey so a field-order difference
 * alone never registers as a divergence, and `_`-prefixed annotations are
 * excluded so they never read as a customization. A key present on one side
 * only counts as diverging.
 */
export function divergingFields(a: unknown, b: unknown): string[] {
  const left = (asRecord(stripAnnotations(a)) ?? {}) as Record<string, unknown>;
  const right = (asRecord(stripAnnotations(b)) ?? {}) as Record<string, unknown>;
  const names = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...names].filter((k) => canonicalKey(left[k]) !== canonicalKey(right[k])).sort();
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
 * Reads ~/.claude.json as an opaque object: unknown Claude-Code-owned state
 * (project memory, auth, etc.) round-trips untouched, and only mcpServers is
 * rewritten. A non-object file throws; a drifted mcpServers entry is preserved
 * raw (see the fallback below).
 *
 * `mcpWritten` is the prior sentinel's record of cc-settings' own definition of
 * each managed server, as of the install that stamped it (see
 * SentinelInfo.mcpWritten) — threaded into isStaleCcOutput so a definition that
 * has since changed doesn't get misclassified as a user hand-edit. Since
 * v12.12.0 this covers every managed server, not just the engine-managed
 * `tldr`: previously any edit to a server's shipped definition orphaned the
 * entry it replaced, which then matched nothing and was preserved forever.
 * Omitted/undefined callers get the original (live-registry-only) detection.
 */
export async function installMcpToClaudeJson(
  teamMcp: McpServers,
  claudeJsonPath: string = CLAUDE_JSON_PATH,
  mcpWritten?: Record<string, unknown> | null,
): Promise<string[]> {
  if (Object.keys(teamMcp).length === 0) {
    debug("No MCP servers in team config");
    return [];
  }

  // Read existing claude.json — tolerate absence, but don't tolerate corruption.
  // readJsonOrNull throws JsonParseError on unparseable JSON (surfaced loudly at
  // the setup.ts top-level catch); a missing file reads as {}.
  const parsed = (await readJsonOrNull(claudeJsonPath)) ?? {};

  // The file must be a JSON object to merge Claude-Code state through. A
  // top-level array or scalar is genuinely unmergeable — THROW (setup exits 1)
  // rather than silently skipping the MCP install while still reporting success.
  //
  // We deliberately do NOT run ClaudeJson.safeParse here. That schema validates
  // `mcpServers` too, so a single drifted server entry (a forward-compat shape
  // we don't model yet) failed this outer gate and returned early — making the
  // raw-preserving fallback below, built for exactly that case, unreachable.
  // Validating only the object shape here lets mcpServers drift flow to that
  // fallback (preserved, not dropped), while still failing loud on real garbage.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `${claudeJsonPath} is not a JSON object (found ${Array.isArray(parsed) ? "array" : typeof parsed}) — ` +
        "refusing to merge MCP servers. Fix or remove the file, then re-run setup.",
    );
  }
  const current = parsed as Record<string, unknown>;

  // Validate existing servers from ~/.claude.json. On schema failure we log a
  // warning but keep the raw value — forward-compat drift (new Claude Code
  // server shapes we don't know yet) should NOT cause us to silently drop user
  // servers. Safety > strict correctness at a write-back boundary.
  const currentMcpRaw = current.mcpServers;
  let currentMcp: McpServers = {};
  if (currentMcpRaw !== undefined) {
    const currentResult = McpServersSchema.safeParse(currentMcpRaw);
    if (currentResult.success) {
      currentMcp = currentResult.data;
    } else if (
      typeof currentMcpRaw === "object" &&
      currentMcpRaw !== null &&
      !Array.isArray(currentMcpRaw)
    ) {
      // The map is a real object but failed schema validation — preserve it
      // PER ENTRY: keep object-shaped entries (valid servers, or forward-compat
      // shapes we don't model yet) and drop null/scalar/array entries. Downstream
      // stale-output detection does `"command" in entry` (isStdioServer), which
      // throws on a non-object — so a single bad entry must not ride along, even
      // though the surrounding map is worth preserving.
      debug(
        `Existing MCP servers in ${claudeJsonPath} failed schema validation (preserving valid-shaped entries): ${currentResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
      const preserved: Record<string, unknown> = {};
      for (const [name, entry] of Object.entries(currentMcpRaw)) {
        if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
          preserved[name] = entry;
        } else {
          debug(
            `Dropping non-object MCP entry "${name}" in ${claudeJsonPath} (${Array.isArray(entry) ? "array" : entry === null ? "null" : typeof entry}).`,
          );
        }
      }
      currentMcp = preserved as McpServers;
    } else {
      // A non-object mcpServers (array/scalar/null) can't be merged without
      // silently discarding whatever the user had there. Refuse loudly rather
      // than overwrite it — the same fail-closed posture as a non-object
      // claude.json above. (A missing mcpServers is undefined and handled by
      // the outer guard, so this only fires on a genuinely malformed value.)
      throw new Error(
        `${claudeJsonPath} has a non-object "mcpServers" (${Array.isArray(currentMcpRaw) ? "array" : typeof currentMcpRaw}) — ` +
          "refusing to overwrite it. Fix or remove the field, then re-run setup.",
      );
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
    const priorWritten = mcpWritten?.[name] as McpServer | undefined;
    if (teamEntry && isStaleCcOutput(name, entry, teamEntry, priorWritten)) continue;
    effectiveCurrentMcp[name] = entry;
  }

  // Team provides a baseline; user entries shadow on conflict (so the user's
  // local tweak to a shared server wins). Same semantics as the bash merge.
  const mergedMcp: McpServers = { ...teamMcp, ...effectiveCurrentMcp };
  const next = { ...current, mcpServers: mergedMcp };
  await atomicWriteJson(claudeJsonPath, next);
  debug(`Installed MCP servers to ${claudeJsonPath}`);

  // Shipped names the user's own definition shadowed. The install summary marks
  // these so "cc-settings ships this server" is never read as "cc-settings'
  // definition is what's running" — the distinction that let a stale entry sit
  // unnoticed through repeated installs.
  return Object.keys(teamMcp).filter((name) => name in effectiveCurrentMcp);
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
  mcpWritten?: Record<string, unknown> | null,
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
    const teamDef = teamServers[name];
    if (teamDef === undefined) continue;
    // Same stale-output test ~/.claude.json gets. settings.json holds its own
    // copy of the MCP block, and without this check a definition cc-settings
    // itself wrote on an earlier version reads as a user customization here and
    // is preserved forever — which is exactly how a pre-v12.8.1 `tldr` entry
    // survived every reinstall while ~/.claude.json was being updated correctly.
    if (isStaleCcOutput(name, userDef, teamDef, mcpWritten?.[name] as McpServer | undefined)) {
      continue;
    }
    if (functionalKey(userDef) !== functionalKey(teamDef)) {
      diverged.push(name);
      userOverrides[name] = userDef;
    }
  }
  if (diverged.length > 0) {
    info(`Preserving your customization of ${diverged.length} shared MCP server(s):`);
    for (const name of diverged) {
      const fields = divergingFields(userServers[name], teamServers[name]);
      info(`  - ${name} (differs in: ${fields.join(", ") || "unknown"})`);
      // A divergence confined to serverInstructions, with command/args identical,
      // is almost never a deliberate customization — it is this installer's own
      // output from a version whose instruction text has since changed. Saying so
      // is the difference between a benign-looking line and an actionable one.
      if (fields.length === 1 && fields[0] === "serverInstructions") {
        info(
          `    Same command/args, only the description text differs — usually a stale entry from an older cc-settings.`,
        );
        info(`    Delete "${name}" from mcpServers in settings.json and re-run to re-sync.`);
      }
    }
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
  mcpWritten?: Record<string, unknown> | null,
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

  const resolvedMcp = await resolveMcpServers(userServers, teamServers, mcpWritten);

  // Delegate to the pure merger, supplying the already-resolved mcpServers.
  // The pure merger skips the mcpServers key in its per-key strategy loop and
  // uses the value we computed here instead.
  return mergeSettings(existingPath, teamSettings, outputPath, opts, resolvedMcp);
}
